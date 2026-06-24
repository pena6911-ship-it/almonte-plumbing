-- Migration 003: leads table (form submissions from website)
-- Run AFTER 002-appointments.sql (leads references appointments).
-- Run in: Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS leads (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at       TIMESTAMPTZ DEFAULT now(),
  first_name       TEXT,
  last_name        TEXT,
  phone            TEXT NOT NULL,
  email            TEXT,
  service_type     TEXT,
  urgency          TEXT,
  description      TEXT,
  address          TEXT,
  preferred_date   DATE,
  preferred_time   TEXT,
  status           TEXT DEFAULT 'new'
    CHECK (status IN ('new', 'contacted', 'booked', 'declined')),
  notes            TEXT,
  client_id        UUID REFERENCES clients(id) ON DELETE SET NULL,
  appointment_id   UUID REFERENCES appointments(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS leads_status_idx    ON leads(status);
CREATE INDEX IF NOT EXISTS leads_created_idx   ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS leads_client_idx    ON leads(client_id);
