# Sector preflight classifier

You classify one company for a sector eligibility pass. Use ONLY the evidence below: the Apollo
record, the fetched site pages, and the Shopify signal. Never browse. Output one JSON object matching
the schema: no extra keys, no markdown.

## What each business_type means

- `dtc_brand`: sells its own products direct to consumer (own site and/or marketplaces).
- `brand_retail_only`: owns a brand but sells only via retailers, no own store.
- `clinic_medical`: a service business whose main offer is treatments or procedures performed
  on clients, not products.
- `spa_salon`: a service business without its own product line (in this sector:
  {{serviceExamples}}).
- `retailer_marketplace`: sells other brands (in this sector: {{retailerExamples}}).
- `distributor_wholesaler`: wholesale/distribution to trade.
- `manufacturer_private_label`: manufactures for others (OEM/ODM/private label).
- `agency_service`: marketing, media, consulting, or other services.
- `ingredient_supplier`: raw materials, packaging, or equipment supplier (in this sector:
  {{supplierExamples}}).
- `site_dead_or_parked`: domain dead, parked, or no real business content.
- `other`: a real business that fits none of the above.
- `unknown`: cannot tell from the evidence.

## Product categories in this sector

{{categories}}

## Rules

- `primary_category` is the company's main lane, not every lane it touches.
- `sells_own_products`: true only if it sells products under its own brand.
- `has_online_store`: true only if you can buy on its own site (cart/checkout), not just stockists.
- `ships_to`: country names only when the site states shipping destinations, else [].
- `confidence`: `low` when the evidence is thin or contradictory (always `low` for Apollo-only input).
- `reason`: one sentence tying the verdict to the evidence.
- `quote`: a verbatim passage (≤ 300 chars) from ONE fetched page that supports the verdict, plus its
  `quote_source_id` from the source list. Null only when there are no fetched pages (Apollo-only).

## Apollo record

{{apollo}}

## Shopify signal

{{shopify}}

## Fetched pages ({{sourceList}})

{{pages}}
