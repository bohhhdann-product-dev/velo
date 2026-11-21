CREATE TABLE app_users (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES app_users(id),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  board jsonb NOT NULL,
  viewport jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(board) = 'object'),
  CHECK (jsonb_typeof(viewport) = 'object')
);
CREATE INDEX projects_owner_updated_idx ON projects(owner_id, updated_at DESC);

-- Keep accepted results after deletion so a lost response is safe to retry.
CREATE TABLE mutation_receipts (
  owner_id text NOT NULL REFERENCES app_users(id),
  scope text NOT NULL,
  client_mutation_id text NOT NULL,
  fingerprint text NOT NULL,
  reply jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, scope, client_mutation_id)
);
