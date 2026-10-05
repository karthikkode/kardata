-- 0026_phase4: global Meta concurrency limiter. Permit rows bound live
-- Meta calls across all worker replicas; holders are unique per call and
-- leases expire crashed holders back into the pool.

-- migrate:up

CREATE TABLE IF NOT EXISTS meta_permits (
  slot integer PRIMARY KEY,
  holder text,
  held_at timestamptz
);

-- migrate:down

DROP TABLE IF EXISTS meta_permits;
