-- Workspace file indexing and legacy context import. No owner data removed.
-- migrate:up
ALTER TABLE workspace_files ADD COLUMN document_id text;
ALTER TABLE workspace_files ADD COLUMN approval_id text REFERENCES workspace_changes(id);
ALTER TABLE research_work ADD COLUMN cursor jsonb;
ALTER TABLE sector_documents ADD COLUMN archive_key text;
ALTER TABLE sector_documents ADD COLUMN original_hash text;

-- Import owner-authored notes instead of discarding legacy working context.
INSERT INTO sector_workspace(sector_id,research_session_id,context_version,sections,protected_decisions)
SELECT s.id,s.research_session_id,1,
  jsonb_build_object('scope',CASE WHEN s.topic='' THEN s.name ELSE s.topic END,
    'decisions',COALESCE(n.notes,''),'findings','','questions',''),COALESCE(n.notes,'')
FROM sectors s LEFT JOIN (
  SELECT sector_id,string_agg(text,E'\n\n' ORDER BY created_at,id) AS notes FROM sector_context_notes GROUP BY sector_id
) n ON n.sector_id=s.id
ON CONFLICT(sector_id) DO UPDATE SET context_version=CASE WHEN sector_workspace.context_version=0 THEN 1 ELSE sector_workspace.context_version END, sections=CASE WHEN sector_workspace.context_version=0 THEN EXCLUDED.sections ELSE sector_workspace.sections END, protected_decisions=CASE WHEN sector_workspace.context_version=0 THEN EXCLUDED.protected_decisions ELSE sector_workspace.protected_decisions END;
INSERT INTO workspace_changes(id,sector_id,base_version,sections,source_thread,author,state,version)
SELECT 'legacy-context-'||sector_id,sector_id,0,sections,'migration','owner','approved',1 FROM sector_workspace ON CONFLICT(id) DO NOTHING;
-- Existing files remain discoverable. Their previously implicit automatic
-- inclusion is surfaced for explicit review under the new approval contract.
INSERT INTO workspace_changes(id,sector_id,base_version,sections,source_thread,author,state,file_ref)
SELECT 'legacy-file-'||d.id,d.sector_id,1,w.sections,'migration','owner','pending',
  jsonb_build_object('fileId',d.id,'hash',d.sha256,'filename',d.filename,'ords',
    COALESCE((SELECT jsonb_agg(u.ord ORDER BY u.ord) FROM sector_document_units u WHERE u.document_id=d.id),'[]'::jsonb))
FROM sector_documents d JOIN sector_workspace w ON w.sector_id=d.sector_id
WHERE d.status='indexed' AND NOT EXISTS(SELECT 1 FROM sector_context_selection x WHERE x.sector_id=d.sector_id AND x.document_id=d.id AND x.unit_ord=-1 AND x.excluded) ON CONFLICT(id) DO NOTHING;

-- migrate:down
DELETE FROM workspace_changes WHERE id LIKE 'legacy-context-%' OR id LIKE 'legacy-file-%';
ALTER TABLE sector_documents DROP COLUMN original_hash;
ALTER TABLE sector_documents DROP COLUMN archive_key;
ALTER TABLE research_work DROP COLUMN cursor;
ALTER TABLE workspace_files DROP COLUMN approval_id;
ALTER TABLE workspace_files DROP COLUMN document_id;
