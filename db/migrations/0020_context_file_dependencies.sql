-- Preserve source dependency lineage without modifying stored transcript text.
-- migrate:up
ALTER TABLE thread_context ADD COLUMN file_exposures jsonb NOT NULL DEFAULT '[]';
ALTER TABLE thread_context ADD COLUMN file_inheritance_set boolean NOT NULL DEFAULT false;
ALTER TABLE thread_context ADD COLUMN summary_file_refs jsonb;
ALTER TABLE thread_context ADD COLUMN working_file_refs jsonb;
ALTER TABLE thread_context ADD COLUMN history_provenance_known boolean NOT NULL DEFAULT true;
ALTER TABLE thread_context ADD COLUMN rebuilt_history boolean NOT NULL DEFAULT false;
ALTER TABLE thread_context ADD COLUMN rebuilt_outbox_floor bigint NOT NULL DEFAULT 0;
ALTER TABLE workspace_changes ADD COLUMN source_refs jsonb;
ALTER TABLE sector_workspace ADD COLUMN section_file_refs jsonb NOT NULL DEFAULT '{}';
-- Existing conversations have no server-verified historical exposure ledger.
INSERT INTO thread_context(thread_key,history_provenance_known) SELECT key,false FROM threads
 ON CONFLICT(thread_key) DO UPDATE SET history_provenance_known=false;
-- Null dependency receipts explicitly mean unknown legacy provenance.
UPDATE sector_workspace SET section_file_refs='{"scope":null,"decisions":null,"findings":null,"questions":null}'::jsonb
 WHERE EXISTS (SELECT 1 FROM jsonb_each_text(sections) WHERE value<>'');
-- migrate:down
ALTER TABLE sector_workspace DROP COLUMN section_file_refs;
ALTER TABLE workspace_changes DROP COLUMN source_refs;
ALTER TABLE thread_context DROP COLUMN rebuilt_outbox_floor;
ALTER TABLE thread_context DROP COLUMN rebuilt_history;
ALTER TABLE thread_context DROP COLUMN history_provenance_known;
ALTER TABLE thread_context DROP COLUMN working_file_refs;
ALTER TABLE thread_context DROP COLUMN summary_file_refs;
ALTER TABLE thread_context DROP COLUMN file_inheritance_set;
ALTER TABLE thread_context DROP COLUMN file_exposures;
