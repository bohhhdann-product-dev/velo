ALTER TABLE app_users ADD COLUMN display_name text NOT NULL DEFAULT '';
ALTER TABLE app_users ADD COLUMN email text NOT NULL DEFAULT '';
ALTER TABLE app_users ADD COLUMN profile_synced_at timestamptz;
ALTER TABLE app_users ADD COLUMN nsfw_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE app_users ADD COLUMN discount_percent smallint NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100);
ALTER TABLE app_users ADD COLUMN blocked_at timestamptz;
ALTER TABLE app_users ADD COLUMN block_reason text NOT NULL DEFAULT '';
ALTER TABLE app_users ADD COLUMN admin_revision integer NOT NULL DEFAULT 1 CHECK (admin_revision > 0);

ALTER TABLE token_ledger DROP CONSTRAINT token_ledger_kind_check;
ALTER TABLE token_ledger ADD CONSTRAINT token_ledger_kind_check
  CHECK (kind IN ('welcome', 'demo_purchase', 'reserve', 'spend', 'release', 'admin_grant'));
-- Existing checkouts were simulated; none represent received money.
ALTER TABLE token_checkouts ADD COLUMN payment_mode text NOT NULL DEFAULT 'test' CHECK (payment_mode IN ('test', 'live'));

CREATE TABLE admin_audit (
  id uuid PRIMARY KEY,
  actor_id text NOT NULL REFERENCES app_users(id),
  target_id text NOT NULL REFERENCES app_users(id),
  action text NOT NULL CHECK (action IN ('settings', 'grant', 'status')),
  request_id uuid NOT NULL,
  fingerprint text NOT NULL,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(actor_id, request_id)
);
CREATE INDEX admin_audit_target_created ON admin_audit(target_id, created_at DESC);
CREATE FUNCTION reject_admin_audit_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Admin audit entries are immutable'; END;
$$;
CREATE TRIGGER admin_audit_immutable BEFORE UPDATE OR DELETE ON admin_audit
  FOR EACH ROW EXECUTE FUNCTION reject_admin_audit_mutation();
