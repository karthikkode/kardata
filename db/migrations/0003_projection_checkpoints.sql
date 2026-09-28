-- 0003_projection_checkpoints: high-water mark so request-scoped projection
-- applies each event exactly once. B3.1.

-- migrate:up

CREATE TABLE IF NOT EXISTS projection_checkpoints (
  name TEXT PRIMARY KEY,
  seq BIGINT NOT NULL DEFAULT 0
);

-- migrate:down

DROP TABLE IF EXISTS projection_checkpoints;
