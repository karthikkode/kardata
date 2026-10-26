-- Stage 5.3 step 2/3: accounts figures and the revenue plausibility verdict.
INSERT INTO "fact_keys" ("key", "area", "value_type", "unit", "description", "qualifier_names", "status", "created_by") VALUES
  ('financials.total_assets', 'financials', 'money', NULL, 'Total assets from the latest filed accounts', '{}', 'approved', 'seed'),
  ('financials.cash', 'financials', 'money', NULL, 'Cash from the latest filed accounts', '{}', 'approved', 'seed'),
  ('financials.net_assets', 'financials', 'money', NULL, 'Net assets from the latest filed accounts', '{}', 'approved', 'seed'),
  ('financials.revenue_plausibility', 'financials', 'text', NULL, 'Plausibility verdict on the revenue figure: ok, or disputed with the reason', '{}', 'approved', 'seed')
ON CONFLICT ("key") DO NOTHING;
