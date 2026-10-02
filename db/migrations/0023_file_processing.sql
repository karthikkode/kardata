-- File-owned OCR work and exact paid-attempt receipts. Additive; no legacy rewrites.
-- migrate:up
CREATE TABLE file_processing_jobs (
 id text PRIMARY KEY, document_id text NOT NULL UNIQUE REFERENCES sector_documents(id), sector_id text NOT NULL REFERENCES sectors(id),
 original_hash text NOT NULL, archive_key text NOT NULL, provider text NOT NULL, model text NOT NULL,
 parser_version text NOT NULL, prompt_version text NOT NULL,
 state text NOT NULL CHECK(state IN ('queued','processing','paused','failed','uncertain','complete')),
 revision integer NOT NULL DEFAULT 0, manifest_ref jsonb, expected_images integer, extraction_hash text,
 dispatch_state text NOT NULL DEFAULT 'unreserved' CHECK(dispatch_state IN ('unreserved','reserved','confirmed','uncertain')), dispatch_nonce uuid, dispatch_workflow_id text, dispatch_execution_id text, last_error_code text, staged_revision integer, staged_count bigint NOT NULL DEFAULT 0, staged_digest text, staged_full_chars bigint NOT NULL DEFAULT 0, staged_preview text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(sector_id,original_hash,parser_version,provider,model,prompt_version)
);
ALTER TABLE sector_documents ADD COLUMN full_chars bigint;
ALTER TABLE sector_documents ADD COLUMN text_truncated boolean NOT NULL DEFAULT false;
UPDATE sector_documents SET full_chars=char_length(text);
ALTER TABLE sector_document_units ADD COLUMN source_page integer;
ALTER TABLE sector_document_units ADD COLUMN source_image_id text;
ALTER TABLE sector_document_units ADD COLUMN source_image_ordinal integer;
ALTER TABLE sector_document_units ADD COLUMN source_image_role text;
CREATE INDEX file_processing_jobs_state_idx ON file_processing_jobs(state,updated_at,id);
CREATE TABLE file_processing_images (
 job_id text NOT NULL REFERENCES file_processing_jobs(id), image_id text NOT NULL,
 page integer NOT NULL CHECK(page>=1), ordinal integer NOT NULL CHECK(ordinal>=0), image_hash text NOT NULL, role text NOT NULL DEFAULT 'embedded' CHECK(role IN ('embedded','page-visual')),
 input_ref jsonb NOT NULL, width integer NOT NULL CHECK(width>0), height integer NOT NULL CHECK(height>0),
 state text NOT NULL CHECK(state IN ('pending','claimed','requesting','response-staged','complete','failed','uncertain')),
 attempt integer NOT NULL DEFAULT 0, PRIMARY KEY(job_id,image_id), UNIQUE(job_id,page,ordinal)
);
CREATE TABLE file_processing_attempts (
 job_id text NOT NULL, image_id text NOT NULL, attempt integer NOT NULL CHECK(attempt>0),
 lease uuid NOT NULL, producer_id text NOT NULL, deadline_at timestamptz NOT NULL,
 state text NOT NULL CHECK(state IN ('claimed','requesting','response-staged','complete','failed','uncertain')),
 request_started_at timestamptz, pending_response jsonb, pending_response_text text, result_ref jsonb, units jsonb, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(job_id,image_id,attempt), FOREIGN KEY(job_id,image_id) REFERENCES file_processing_images(job_id,image_id)
);
CREATE INDEX file_processing_attempts_admission_idx ON file_processing_attempts(state,deadline_at);
-- migrate:down
DO $$ BEGIN IF EXISTS(SELECT 1 FROM file_processing_jobs) THEN RAISE EXCEPTION 'File processing receipts must be preserved; rollback requires an empty owned test database'; END IF; END $$;
DROP TABLE file_processing_attempts;
DROP TABLE file_processing_images;
DROP TABLE file_processing_jobs;
ALTER TABLE sector_documents DROP COLUMN text_truncated;
ALTER TABLE sector_documents DROP COLUMN full_chars;
ALTER TABLE sector_document_units DROP COLUMN source_image_role;
ALTER TABLE sector_document_units DROP COLUMN source_image_ordinal;
ALTER TABLE sector_document_units DROP COLUMN source_image_id;
ALTER TABLE sector_document_units DROP COLUMN source_page;
