-- 0012_sector_research_session: which chat session started the research.
-- The agent starts research from a sector chat via db.start_sector_research;
-- the calling session is recorded here so the chat can pin it. State still
-- owns exclusivity (only drafts start); this column is identity, not a lock.

-- migrate:up

ALTER TABLE sectors ADD COLUMN IF NOT EXISTS research_session_id TEXT;

-- migrate:down

ALTER TABLE sectors DROP COLUMN IF EXISTS research_session_id;
