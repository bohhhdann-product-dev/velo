ALTER TABLE projects ADD COLUMN deleted_at timestamptz;
CREATE INDEX projects_active_owner_idx ON projects(owner_id, updated_at DESC) WHERE deleted_at IS NULL;
