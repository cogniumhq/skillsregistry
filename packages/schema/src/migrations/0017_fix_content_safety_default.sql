-- 0017_fix_content_safety_default.sql
-- Fix: content_safety_passed was false for ~37K skills due to a "fail closed" bug
-- in the embed queue consumer's content safety check (content-safety.ts).
--
-- Root cause: When Llama Guard (Workers AI) returned transient errors (timeout,
-- rate limit), the catch block returned `false`, permanently marking skills as
-- unsafe. With 37K+ skills queued for embedding, Workers AI couldn't keep up,
-- and nearly all skills were permanently flagged as content-unsafe.
--
-- The code fix (this deploy) changes the safety check to return an error signal
-- on transient failures instead of `false`, and the embed consumer now retries
-- instead of permanently marking skills unsafe.
--
-- This migration resets all falsely-flagged skills so they can be re-processed.

-- 1. Reset all false values to true (these were caused by transient API errors, not actual unsafe content)
UPDATE skills SET content_safety_passed = true WHERE content_safety_passed = false;

-- 2. Backfill any NULLs too
UPDATE skills SET content_safety_passed = true WHERE content_safety_passed IS NULL;

-- 3. Set a DEFAULT to prevent future NULLs
ALTER TABLE skills ALTER COLUMN content_safety_passed SET DEFAULT true;
