-- 0004_outbox_notify: wake SSE listeners on every published frame. B3.2.
-- The payload carries only the outbox seq (8000-byte NOTIFY limit); the
-- stream re-selects the row. Filtering by thread happens in the listener.

-- migrate:up

CREATE OR REPLACE FUNCTION notify_outbox() RETURNS trigger AS $$
BEGIN
  PERFORM pg_notify('kardata_outbox', NEW.seq::text);
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS outbox_notify ON outbox;
CREATE TRIGGER outbox_notify AFTER INSERT ON outbox FOR EACH ROW EXECUTE FUNCTION notify_outbox();

-- migrate:down

DROP TRIGGER IF EXISTS outbox_notify ON outbox;
DROP FUNCTION IF EXISTS notify_outbox();
