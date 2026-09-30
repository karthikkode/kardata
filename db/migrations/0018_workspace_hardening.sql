-- Workspace hardening: lookup indexes and value guards.
--
-- Deliberately no FOREIGN KEYs from thread_context/thread_instructions to
-- threads(key): local memory (durable summaries, continuations, steering)
-- is authoritative owner data, not a disposable projection. A hard FK
-- would block rebuildFromEvents (which truncates threads) and the
-- t.session.deleted projector path. Orphan cleanup lives in the projector
-- delete path instead; thread_key is already the thread_context PK and
-- thread_instructions carries (thread_key,state,at).
-- migrate:up
CREATE INDEX workspace_changes_source ON workspace_changes(sector_id, source_thread);
CREATE INDEX workspace_files_document ON workspace_files(document_id) WHERE document_id IS NOT NULL;
CREATE INDEX research_work_child ON research_work(child_id) WHERE child_id IS NOT NULL;
ALTER TABLE workspace_changes ADD CONSTRAINT workspace_changes_base_version_check CHECK (base_version >= 0);
ALTER TABLE workspace_changes ADD CONSTRAINT workspace_changes_author_check CHECK (author IN ('owner', 'research', 'session'));
ALTER TABLE research_work ADD CONSTRAINT research_work_plan_version_check CHECK (plan_version > 0);
ALTER TABLE research_work ADD CONSTRAINT research_work_attempts_check CHECK (attempts >= 0);

-- migrate:down
ALTER TABLE research_work DROP CONSTRAINT research_work_attempts_check;
ALTER TABLE research_work DROP CONSTRAINT research_work_plan_version_check;
ALTER TABLE workspace_changes DROP CONSTRAINT workspace_changes_author_check;
ALTER TABLE workspace_changes DROP CONSTRAINT workspace_changes_base_version_check;
DROP INDEX research_work_child;
DROP INDEX workspace_files_document;
DROP INDEX workspace_changes_source;
