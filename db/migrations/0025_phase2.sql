-- Phase 3 observability spine: every event carries the trace that
-- produced it plus the caller client. trace_id joins the event to its
-- HTTP log, workflow, activity, provider round and MCP lines; client
-- (ui, agent-mcp, system, other) is derived from the route at the HTTP
-- boundary, defaulting to system for background worker writes. The
-- pilot UI-only audit counts mutating events by client.
-- migrate:up

ALTER TABLE events ADD COLUMN trace_id text;
ALTER TABLE events ADD COLUMN client text;
CREATE INDEX IF NOT EXISTS events_trace_id_idx ON events (trace_id);
CREATE INDEX IF NOT EXISTS events_type_at_idx ON events (type, at);

-- migrate:down

DROP INDEX IF EXISTS events_type_at_idx;
DROP INDEX IF EXISTS events_trace_id_idx;
ALTER TABLE events DROP COLUMN IF EXISTS client;
ALTER TABLE events DROP COLUMN IF EXISTS trace_id;
