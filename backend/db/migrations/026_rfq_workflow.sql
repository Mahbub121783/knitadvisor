-- ============================================================================
-- 026 — RFQ (Request For Quotation) workflow
--
-- Tier 1 item 2: a real buyer-facing quote-request flow, distinct from the
-- admin "Inquiries" tab (which is just a log viewer over query_logs — every
-- /api/calculate call, not a submitted request). A buyer fills in contact
-- details and one or more line items (fabric/GSM/garment/quantity); each
-- line item gets a REFERENCE price computed from the SAME calculate() +
-- garment-costing engines the rest of the app uses, frozen at submission
-- time (never recomputed later — a quote must reflect what was true when
-- asked, not today's yarn price, the same principle dyeing_recipes' Taka
-- prices already follow — see migration 021's own header). The admin then
-- sets a real quoted_price per line and moves the request through a status
-- lifecycle; the buyer checks back with a short reference code, no account
-- or login needed.
-- ============================================================================

CREATE TABLE rfq_requests (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  -- Short, public-facing lookup code (e.g. "RFQ-7F3K9A") — a buyer checks
  -- status with this alone, so it must be unguessable enough not to leak
  -- another buyer's quote by brute force, but short enough to read over
  -- email/phone. See rfq-engine.js's generateReferenceCode for the exact
  -- alphabet/length choice and the collision-retry loop that uses it.
  reference_code  text UNIQUE NOT NULL,
  buyer_name      text NOT NULL,
  buyer_email     text NOT NULL,
  buyer_company   text,
  buyer_country   text,
  buyer_phone     text,
  message         text,
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'under_review', 'quoted', 'accepted', 'rejected', 'expired')),
  admin_notes     text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  quoted_at       timestamptz,
  ip_hash         text
);
CREATE INDEX idx_rfq_requests_reference_code ON rfq_requests (reference_code);
CREATE INDEX idx_rfq_requests_status ON rfq_requests (status);
CREATE INDEX idx_rfq_requests_created_at ON rfq_requests (created_at);
-- set_updated_at() already exists (migration 001) — reused, not redefined.
CREATE TRIGGER rfq_requests_updated_at BEFORE UPDATE ON rfq_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE rfq_line_items (
  id                          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  rfq_id                      integer NOT NULL REFERENCES rfq_requests(id) ON DELETE CASCADE,
  line_number                 integer NOT NULL,
  fabric_id                   text NOT NULL,
  fabric_name                 text NOT NULL,
  gsm                         numeric NOT NULL,
  composition                 text,
  garment_type                text,
  garment_weight_g            numeric,
  order_quantity              integer,
  -- The buyer's own ask, when they name one — never overwritten by the
  -- reference calculation, kept as a separate column so the two are always
  -- visible side by side to the admin.
  target_price_usd            numeric(10,4),
  -- KnitAdvisor's own computed figures at submission time — see the
  -- migration header for why these are frozen, not live-recomputed.
  reference_fabric_price_usd  numeric(10,4),
  reference_fob_price_usd     numeric(10,4),
  reference_calc_snapshot     jsonb,
  -- What the admin actually offers, once reviewed.
  quoted_price_usd            numeric(10,4),
  quoted_notes                text,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rfq_line_items_unique_line UNIQUE (rfq_id, line_number)
);
CREATE INDEX idx_rfq_line_items_rfq_id ON rfq_line_items (rfq_id);
