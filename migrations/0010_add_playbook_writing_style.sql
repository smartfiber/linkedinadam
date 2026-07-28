ALTER TABLE playbooks
ADD COLUMN writing_style_prompt TEXT;

ALTER TABLE playbooks
ADD COLUMN updated_at TEXT;

ALTER TABLE employees
ADD COLUMN writing_style_prompt_override TEXT;

UPDATE playbooks
SET updated_at = created_at
WHERE updated_at IS NULL;
