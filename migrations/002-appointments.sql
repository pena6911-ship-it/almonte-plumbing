-- Migration 002: appointments table
-- Run in: Supabase Dashboard → SQL Editor

CREATE TABLE IF NOT EXISTS appointments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at         TIMESTAMPTZ DEFAULT now(),
  client_id          UUID REFERENCES clients(id) ON DELETE SET NULL,
  service_description TEXT,
  scheduled_date     DATE NOT NULL,
  start_time         TIME NOT NULL,
  end_time           TIME NOT NULL,
  duration_minutes   INTEGER DEFAULT 60,
  google_event_id    TEXT,
  notes              TEXT,
  status             TEXT DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  invoice_id         UUID REFERENCES invoices(id) ON DELETE SET NULL
);

-- Index for quick date lookups
CREATE INDEX IF NOT EXISTS appointments_date_idx ON appointments(scheduled_date);
CREATE INDEX IF NOT EXISTS appointments_client_idx ON appointments(client_id);
