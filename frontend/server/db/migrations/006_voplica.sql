-- Provider upload checkpoints survive worker restarts. No credentials or media bytes.
ALTER TABLE generation_takes ADD COLUMN provider_state jsonb NOT NULL DEFAULT '{}';
-- Keep the upstream credit accounting after temporary result URLs have been cleared.
ALTER TABLE generation_takes ADD COLUMN provider_usage jsonb;
