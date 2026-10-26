-- Stage 5.3 step 1: Apollo revenue carries its estimate status as qualifiers.
UPDATE "fact_keys"
SET "qualifier_names" = ARRAY['source', 'estimate_kind', 'estimate_status']
WHERE "key" = 'financials.revenue_estimate';
