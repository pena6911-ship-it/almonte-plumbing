-- Migration: add county, job_type, and effective_tax_rate to invoices
-- Run in: Supabase Dashboard → SQL Editor

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS county            TEXT DEFAULT 'union',
  ADD COLUMN IF NOT EXISTS job_type          TEXT DEFAULT 'repair'
    CHECK (job_type IN ('repair', 'capital_improvement')),
  ADD COLUMN IF NOT EXISTS effective_tax_rate NUMERIC(5,4) DEFAULT 0.0675;
