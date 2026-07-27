ALTER TABLE content_drafts
ADD COLUMN image_key TEXT;

ALTER TABLE content_drafts
ADD COLUMN image_prompt TEXT;

ALTER TABLE content_drafts
ADD COLUMN image_status TEXT
CHECK (
  image_status IS NULL
  OR image_status IN ('generated', 'approved')
);

ALTER TABLE content_drafts
ADD COLUMN image_mime_type TEXT;

ALTER TABLE content_drafts
ADD COLUMN image_updated_at TEXT;
