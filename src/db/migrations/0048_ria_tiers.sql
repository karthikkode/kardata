ALTER TABLE sector_companies ADD COLUMN ria_decision text;
ALTER TABLE sector_companies ADD COLUMN ria_tier integer;
ALTER TABLE sector_companies ADD COLUMN ria_registration jsonb;
ALTER TABLE sector_companies ADD CONSTRAINT ria_classification_valid CHECK (COALESCE(
  (ria_decision IS NULL AND ria_tier IS NULL) OR
  (ria_decision = 'Accept' AND ria_tier IS NOT NULL AND ria_tier IN (0, 1, 2)) OR
  (ria_decision IN ('Hold', 'Reject') AND ria_tier IS NULL)
, false));
CREATE INDEX sector_companies_ria_classification_idx ON sector_companies (sector_id, ria_decision, ria_tier, eligibility_reason);
