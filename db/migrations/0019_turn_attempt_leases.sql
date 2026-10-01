-- Fence late callbacks from cancelled/retried activities without altering history.
-- migrate:up
ALTER TABLE thread_context ADD COLUMN active_lease text;
-- migrate:down
ALTER TABLE thread_context DROP COLUMN active_lease;
