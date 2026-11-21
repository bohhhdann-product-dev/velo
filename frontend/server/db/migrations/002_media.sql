CREATE TABLE assets (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES app_users(id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('upload', 'sheet')),
  mime_type text NOT NULL DEFAULT 'image/webp',
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  source_key text NOT NULL UNIQUE,
  preview_key text NOT NULL UNIQUE,
  sha256 text NOT NULL,
  favorite boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  purged_at timestamptz
);
CREATE INDEX assets_owner_created ON assets(owner_id, created_at DESC);

CREATE TABLE characters (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES app_users(id),
  handle text NOT NULL DEFAULT '',
  document jsonb NOT NULL,
  storage_revision integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX characters_owner_created ON characters(owner_id, created_at DESC);
CREATE UNIQUE INDEX characters_owner_handle ON characters(owner_id, handle)
  WHERE deleted_at IS NULL AND handle <> '';

-- Published rows are only inserted. Editing/deleting a draft never rewrites a version.
CREATE TABLE character_versions (
  id uuid PRIMARY KEY,
  character_id text NOT NULL REFERENCES characters(id),
  owner_id text NOT NULL REFERENCES app_users(id),
  sheet_asset_id uuid NOT NULL REFERENCES assets(id),
  document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX character_versions_owner ON character_versions(owner_id);
CREATE INDEX character_versions_character ON character_versions(character_id);

CREATE TABLE character_mutations (
  character_id text NOT NULL REFERENCES characters(id),
  owner_id text NOT NULL REFERENCES app_users(id),
  mutation_id text NOT NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (character_id, mutation_id)
);
