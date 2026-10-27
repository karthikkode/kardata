-- Stage 5.6 B2: one eligibility path. The rubric is gone; the profile is the
-- single sector config, so the stored rubric column goes with it.
ALTER TABLE "sectors" DROP COLUMN "eligibility_rules";
