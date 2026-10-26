-- Stage 5.3 bugfix: revenue figures carry the kind of their source.
UPDATE "fact_keys"
SET "qualifier_names" = ARRAY['source', 'estimate_kind', 'estimate_status', 'source_kind']
WHERE "key" = 'financials.revenue_estimate';
