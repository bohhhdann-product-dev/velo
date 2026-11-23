ALTER TABLE assets DROP CONSTRAINT assets_kind_check;
ALTER TABLE assets ADD CONSTRAINT assets_kind_check CHECK (kind IN ('upload', 'sheet', 'generated_image', 'generated_video'));
ALTER TABLE assets ALTER COLUMN preview_key DROP NOT NULL;
ALTER TABLE assets ALTER COLUMN width DROP NOT NULL;
ALTER TABLE assets ALTER COLUMN height DROP NOT NULL;
ALTER TABLE assets ADD COLUMN preview_mime_type text DEFAULT 'image/webp';

CREATE TABLE generations (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES app_users(id),
  project_id text NOT NULL REFERENCES projects(id),
  generator_id text NOT NULL,
  draft jsonb NOT NULL,
  manifest jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX generations_owner_created ON generations(owner_id, created_at DESC);
CREATE TABLE generation_takes (
  id uuid PRIMARY KEY,
  generation_id uuid NOT NULL REFERENCES generations(id),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'preparing', 'submitting', 'running', 'ingesting', 'done', 'failed', 'unknown')),
  provider_task_id text,
  provider_response jsonb,
  output_received_at timestamptz,
  output_asset_id uuid REFERENCES assets(id),
  favorite boolean NOT NULL DEFAULT false,
  reserved_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  lease_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX generation_takes_work ON generation_takes(next_attempt_at, created_at)
  WHERE status IN ('queued', 'preparing', 'submitting', 'running', 'ingesting');
CREATE INDEX generation_takes_generation ON generation_takes(generation_id);
