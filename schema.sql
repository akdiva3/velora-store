-- VELORA — D1 Orders Schema
--
-- Run once against your remote database:
--   npx wrangler d1 execute velora-orders --file=schema.sql --remote
--
-- Run locally (mirrors production):
--   npx wrangler d1 execute velora-orders --file=schema.sql --local
--
-- Payment/card data is NEVER stored here.
-- Items are stored as a JSON array for simplicity; normalise in a later stage if needed.

CREATE TABLE IF NOT EXISTS orders (
  -- Identity
  id              TEXT PRIMARY KEY,          -- VEL-{ts}-{rnd}
  created_at      TEXT NOT NULL,             -- ISO 8601 UTC
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending | confirmed | shipped | delivered | cancelled

  -- Customer contact
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  phone           TEXT NOT NULL,             -- stored as +91XXXXXXXXXX

  -- Shipping address
  address         TEXT NOT NULL,
  city            TEXT NOT NULL,
  state           TEXT NOT NULL,
  zip             TEXT NOT NULL,
  country         TEXT NOT NULL,

  -- Shipping method
  shipping_method TEXT NOT NULL DEFAULT 'standard',  -- standard | express
  shipping_cost   REAL NOT NULL DEFAULT 0,

  -- Financials (no payment/card data ever stored)
  subtotal        REAL NOT NULL,
  total           REAL NOT NULL,

  -- Line items: JSON array of {id, name, price, qty, subtotal}
  items           TEXT NOT NULL
);

-- Common query patterns
CREATE INDEX IF NOT EXISTS idx_orders_email      ON orders (email);
CREATE INDEX IF NOT EXISTS idx_orders_status     ON orders (status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at DESC);
