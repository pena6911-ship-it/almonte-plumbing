-- Migration 001 — add square_order_id to invoices
-- Lets the Square payment webhook match an incoming payment back to its invoice.
-- Safe to run multiple times.
--
-- Apply via the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- or the Supabase CLI. Run this once against the project the site uses.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS square_order_id TEXT;

-- Optional: speed up webhook lookups by order id
CREATE INDEX IF NOT EXISTS idx_invoices_square_order_id
  ON invoices (square_order_id);
