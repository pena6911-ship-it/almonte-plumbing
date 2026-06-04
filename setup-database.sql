-- ============================================================
-- Almonte Plumbing — Database Schema
-- Paste this into: Supabase Dashboard → SQL Editor → Run
-- ============================================================

-- ── CLIENTS ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clients (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    TIMESTAMPTZ DEFAULT now(),
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  email         TEXT,
  phone         TEXT NOT NULL,
  address       TEXT,
  city          TEXT,
  state         TEXT DEFAULT 'NC',
  zip           TEXT,
  service_area  TEXT,
  notes         TEXT
);

-- ── SERVICES ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS services (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  TIMESTAMPTZ DEFAULT now(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  price       NUMERIC(10,2) NOT NULL,
  tax_rate    NUMERIC(5,4) DEFAULT 0.0000,
  category    TEXT,
  active      BOOLEAN DEFAULT true
);

-- ── INVOICES ─────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1000;

CREATE TABLE IF NOT EXISTS invoices (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at           TIMESTAMPTZ DEFAULT now(),
  invoice_number       TEXT UNIQUE DEFAULT ('INV-' || to_char(now(), 'YYYY') || '-' || nextval('invoice_number_seq')),
  client_id            UUID REFERENCES clients(id) ON DELETE SET NULL,
  subtotal             NUMERIC(10,2) NOT NULL DEFAULT 0,
  tax_total            NUMERIC(10,2) NOT NULL DEFAULT 0,
  total                NUMERIC(10,2) NOT NULL DEFAULT 0,
  status               TEXT DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','cancelled')),
  notes                TEXT,
  square_invoice_id    TEXT,
  square_order_id      TEXT,   -- Square order id from the payment link; used to match payment webhooks back to this invoice
  square_payment_link  TEXT,
  delivery_method      TEXT DEFAULT 'email' CHECK (delivery_method IN ('email','sms','both')),
  sent_at              TIMESTAMPTZ,
  paid_at              TIMESTAMPTZ,
  due_date             DATE
);

-- ── INVOICE ITEMS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoice_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id    UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  service_id    UUID REFERENCES services(id) ON DELETE SET NULL,
  service_name  TEXT NOT NULL,
  quantity      INTEGER DEFAULT 1,
  unit_price    NUMERIC(10,2) NOT NULL,
  tax_rate      NUMERIC(5,4) NOT NULL DEFAULT 0,
  line_total    NUMERIC(10,2) NOT NULL,
  tax_amount    NUMERIC(10,2) NOT NULL DEFAULT 0
);

-- ── SEED: SERVICES CATALOG ────────────────────────────────────
-- Prices are estimates — update via admin dashboard before launch
INSERT INTO services (name, description, price, category) VALUES
  ('Service Call / Diagnostic',      'On-site visit, diagnosis, and assessment.',                            150.00, 'General'),
  ('Water Heater Repair',            'Diagnosis and repair of existing water heater.',                       350.00, 'Water Heater'),
  ('Water Heater Installation',      'Supply and install new tank or tankless water heater.',                950.00, 'Water Heater'),
  ('Whole House Filtration System',  'Install and configure whole-home water filtration.',                  1500.00, 'Filtration'),
  ('Bathroom Renovation',            'Full plumbing rough-in and fixture install for bathroom remodel.',    5000.00, 'Renovation'),
  ('Kitchen Renovation',             'Kitchen plumbing — sink, dishwasher, disposal lines.',               3500.00, 'Renovation'),
  ('Bathroom Addition',              'New bathroom plumbing rough-in from scratch.',                        8000.00, 'Renovation'),
  ('Toilet Repair',                  'Diagnose and repair running, leaking, or clogged toilet.',             150.00, 'Fixtures'),
  ('Toilet Installation',            'Remove old toilet and install new unit.',                              300.00, 'Fixtures'),
  ('Faucet Repair',                  'Repair dripping or malfunctioning faucet.',                           125.00, 'Fixtures'),
  ('Faucet Installation',            'Install new faucet (customer supplies fixture).',                     200.00, 'Fixtures'),
  ('Drain Cleaning',                 'Professional drain clearing — sink, tub, shower, or main line.',      200.00, 'Drains'),
  ('Drain Repair',                   'Diagnose and repair drain line damage or leak.',                      350.00, 'Drains'),
  ('Gas Line Repair',                'Locate and repair gas line leak or damage.',                          450.00, 'Gas'),
  ('Gas Line Installation',          'New gas line for appliance, fire pit, or generator.',                 850.00, 'Gas'),
  ('Backflow Preventer Installation','Install backflow prevention device per code.',                        500.00, 'General'),
  ('Emergency Service',              '24/7 emergency call — burst pipes, major leaks, no hot water.',       300.00, 'Emergency')
ON CONFLICT (name) DO NOTHING;
