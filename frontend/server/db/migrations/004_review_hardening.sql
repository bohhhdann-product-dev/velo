-- Retired version identities survive for old receipts; only live pins protect media.
ALTER TABLE character_versions ADD COLUMN retired_at timestamptz;
CREATE INDEX character_versions_active_owner ON character_versions(owner_id, created_at) WHERE retired_at IS NULL;

-- Keep mutation keys/fingerprints permanently so expired retries cannot execute twice.
ALTER TABLE mutation_receipts ALTER COLUMN reply DROP NOT NULL;
ALTER TABLE character_mutations ALTER COLUMN response DROP NOT NULL;
CREATE INDEX mutation_receipts_full_reply_age ON mutation_receipts(created_at) WHERE reply IS NOT NULL;
CREATE INDEX character_mutations_full_reply_age ON character_mutations(created_at) WHERE response IS NOT NULL;
