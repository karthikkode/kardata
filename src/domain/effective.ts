import { sql, type SQL } from "drizzle-orm";
import { companies } from "../db/schema.js";
import type { DbLike } from "../db/client.js";

/**
 * Effective company columns in SQL: `override ?? imported` per field, mirroring
 * `toEffectiveCompany`. The subquery never selects `raw`, so list/facets calls
 * stay small. Overrides are trusted to hold domain-validated JSON.
 */
function normalizeDomainSql(website: SQL): SQL<string | null> {
  return sql<string | null>`NULLIF(BTRIM(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(BTRIM(${website})), '^[a-z][a-z0-9+.-]*://', ''), '^//', ''), '[/?#].*$', ''), '^www\\.', '')), '')`;
}

function effectiveArray(
  column: typeof companies.keywords | typeof companies.technologies,
  key: string,
): SQL.Aliased<string[]> {
  return sql<string[]>`CASE WHEN ${companies.overrides} ? ${key} THEN (SELECT COALESCE(array_agg(x), '{}') FROM jsonb_array_elements_text(${companies.overrides}->${key}) AS x) ELSE COALESCE(${column}, '{}') END`.as(
    key,
  );
}

export function effectiveCompanies(db: DbLike) {
  const o = companies.overrides;
  return db
    .select({
      id: companies.id,
      source: companies.source,
      sharedDomain: companies.sharedDomain,
      name: sql<string | null>`COALESCE(${o}->>'name', ${companies.name})`.as("name"),
      website: sql<string | null>`COALESCE(${o}->>'website', ${companies.website})`.as("website"),
      domain: sql<string | null>`CASE WHEN ${o} ? 'website' THEN ${normalizeDomainSql(sql`${o}->>'website'`)} ELSE ${companies.domain} END`.as("domain"),
      country: sql<string | null>`COALESCE(${o}->>'country', ${companies.country})`.as("country"),
      city: sql<string | null>`COALESCE(${o}->>'city', ${companies.city})`.as("city"),
      employees: sql<number | null>`COALESCE((${o}->>'employees')::int, ${companies.employees})`.as("employees"),
      industry: sql<string | null>`COALESCE(${o}->>'industry', ${companies.industry})`.as("industry"),
      foundedYear: sql<number | null>`COALESCE((${o}->>'foundedYear')::int, ${companies.foundedYear})`.as("foundedYear"),
      annualRevenue: sql<string | null>`COALESCE((${o}->>'annualRevenue')::numeric, ${companies.annualRevenue})`.as("annualRevenue"),
      totalFunding: sql<string | null>`COALESCE((${o}->>'totalFunding')::numeric, ${companies.totalFunding})`.as("totalFunding"),
      technologies: effectiveArray(companies.technologies, "technologies"),
      keywords: effectiveArray(companies.keywords, "keywords"),
      hasOverrides: sql<boolean>`${o} <> '{}'::jsonb`.as("hasOverrides"),
    })
    .from(companies)
    .as("company_effective");
}

export type EffectiveCompanies = ReturnType<typeof effectiveCompanies>;
