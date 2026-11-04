# Benchmark inputs

November 4 backup, queried with MCP on a disposable local restore. 17,958 active members, of which 8,403 were eligible. All 17,958 had typed CRDs, with zero duplicate claims. No disclosure-record fallback was needed. The older export covers the eligible subset and has no CRD column. Its Growth column is excluded.

| Key | ADV item and meaning | Unit |
|---|---|---|
| `financials.employees` | 5A total employees | people |
| `sec_adv.advisory_staff`, other 5B keys | 5B(1)–(5) advisory, broker-dealer, state representative, other adviser, insurance roles | people |
| `sec_adv.outside_solicitors` | 5B(6) non-employee solicitors | firms or people |
| `firm.client_total`, `firm.client_individuals`, `firm.client_hnw`, `firm.client_pension`, `sec_adv.client_*` | 5D(1) counts, summed when exact, including individual, high-net-worth and pension categories | clients |
| `sec_adv.aum_*` | 5D(3) client category regulatory AUM | USD |
| `firm.regulatory_aum`, `sec_adv.*discretionary_aum` | 5F(2)(a–c) discretionary, non-discretionary, and total | USD |
| `firm.accounts`, `sec_adv.*discretionary_accounts` | 5F(2)(d–f) discretionary, non-discretionary, and total | accounts |
| `sec_adv.planning_clients*` | 5H filed range and exact count when given | clients |
| `firm.compensation_types`, `sec_adv.compensation_*`, `sec_adv.services_*`, `sec_adv.wrap_*` | 5E, 5G, 5I compensation, service and wrap responses | flags, text, counts |
| `sec_adv.marketing_*`, `sec_adv.business_*`, `sec_adv.other_*`, `sec_adv.affiliation_*` | 5L, 6A/B, 7A marketing, activity and affiliate responses | flags, text, counts |
| `sec_adv.has_website_or_social`, `sec_adv.website_count`, `sec_adv.additional_offices`, `sec_adv.main_office_*` | 1F and 1I location and web fields | flags, state, counts |
| `sec_adv.custody_*`, `sec_adv.qualified_custodian_*` | 9A–F and custody total | flags, USD, counts, month |
| `sec_adv.succession*`, `sec_adv.acquired_firm*` | 4A/B and acquired firms | flag, date, text, count |
| `firm.filing_date`, `firm.registration_status`, `firm.firm_type`, `firm.sec_number`, `sec_adv.has_disclosure` | release metadata, 1D and 11 disclosure | date, text, flag |

Use the registry’s existing `firm` and `financials` keys where definitions match. The existing disclosure flag is text, so the filed Item 11 boolean has a separate key. Snapshot facts use the filing date and release month qualifier.

SEC history ZIP part 1 contains the IA Base A/B, A/B ownership, and D 1.F and 1.I tables. Part 2 contains D 5.K.(3) and 7.A. Join by filing ID and use data through December 31, 2024. Registered-adviser monthly releases for September 2023–2025 are XLSX. The supplied October 2026 ZIP contains `ia09012026.csv`.

Schedule records are `sec_adv_owner` (A/B ownership and officer status) and `sec_adv_schedules` (D 1.F/1.I offices and URLs, 5.K.(3)/7.A custodians). Custodian shares use reported 5.K.(3)(g) dollars divided by 5F total AUM less 5D(3)(d–f). Counts cover reported records. Historical schedule data stops in 2024.
