-- 0013_scan_failure_reason.sql
-- Persist scan failure reasons so we can diagnose batch failures without
-- relying on ephemeral Cloudflare Worker logs.
-- Previously, markScanFailed only logged the reason to console.

ALTER TABLE skills ADD COLUMN IF NOT EXISTS scan_failure_reason TEXT;
