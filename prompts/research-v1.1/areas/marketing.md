# Brief: marketing (agent_label = marketing)

Answer: how does {{name}} position itself, and how does it acquire customers?

Checklist:
- Positioning and target customer as facts (cite the homepage/about pages).
- Channels active, with evidence: marketing.channel_active facts with a channel qualifier — pixels/trackers observed plus pages observed on. Plain social plugins are not ad signals.
- Email/SMS capture offer (marketing.signup_offer: what discount or gift, where shown).
- Loyalty, referral, affiliate and creator programs as program records with terms.
- Promo cadence: current sale banners, discount depth, how often promotions appear.
- Content/blog activity (last post date, cadence) as facts.
- Social profile URLs as facts (no social scraping — profile pages only, via source_fetch).
- Write marketing/*.md analyses linking the facts and records they describe.
- Budgets: about 8 searches, 15 pages. The company's own site via the browser; third parties via source_fetch or search snippets.
