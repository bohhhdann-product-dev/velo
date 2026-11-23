CREATE TABLE token_ledger (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES app_users(id),
  kind text NOT NULL CHECK (kind IN ('welcome', 'demo_purchase', 'reserve', 'spend', 'release')),
  amount integer NOT NULL,
  reserved_delta integer NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_id, idempotency_key)
);
CREATE INDEX token_ledger_owner_created ON token_ledger(owner_id, created_at DESC);
CREATE FUNCTION reject_token_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Token ledger entries are immutable'; END;
$$;
CREATE TRIGGER token_ledger_immutable BEFORE UPDATE OR DELETE ON token_ledger
  FOR EACH ROW EXECUTE FUNCTION reject_token_ledger_mutation();

CREATE TABLE token_checkouts (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES app_users(id),
  idempotency_key uuid NOT NULL,
  pack_id text NOT NULL,
  tokens integer NOT NULL CHECK (tokens > 0),
  price_cents integer NOT NULL CHECK (price_cents > 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid')),
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  UNIQUE(owner_id, idempotency_key)
);
ALTER TABLE generations ADD COLUMN token_quote jsonb;
ALTER TABLE generation_takes ADD COLUMN price_tokens integer NOT NULL DEFAULT 0 CHECK (price_tokens >= 0);
ALTER TABLE generation_takes ADD COLUMN token_state text NOT NULL DEFAULT 'legacy' CHECK (token_state IN ('legacy', 'reserved', 'spent', 'released'));
ALTER TABLE generation_takes ADD COLUMN preparation_started_at timestamptz;
