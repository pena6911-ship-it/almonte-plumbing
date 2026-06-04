-- Migration: add discount fields to invoices
-- Run in: Supabase Dashboard → SQL Editor

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS discount_type   TEXT DEFAULT 'flat'
    CHECK (discount_type IN ('flat', 'percent')),
  ADD COLUMN IF NOT EXISTS discount_value  NUMERIC(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) DEFAULT 0;
