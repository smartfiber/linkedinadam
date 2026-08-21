ALTER TABLE github_sync_runs ADD COLUMN outcome TEXT
  CHECK (outcome IS NULL OR outcome IN ('succeeded', 'partial', 'failed'));

ALTER TABLE github_sync_runs ADD COLUMN result_json TEXT;
