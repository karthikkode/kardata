# Brief: reviews (agent_label = reviews)

Answer: where is {{name}} reviewed, how is it rated, and what do customers love and hate?

Checklist:
- Which review platforms exist for this company (on-site widget, Google, Trustpilot, Yelp, Judge.me/Loox/Stamped widgets, retail sites). Per platform store reviews.avg_rating and reviews.count facts with a platform qualifier, each citing its source.
- If a reviews.app fact names an on-site widget (Judge.me, Stamped, Yotpo, Loox, Okendo, Bazaarvoice), you MUST ingest up to 300 most recent on-site reviews through reviews_ingest (widget via the browser) — this is the area's main deliverable, not optional. Never store reviewer identities — the tool strips them; drop any that slip through.
- Distill the top 5 positive and top 5 negative themes as review_theme records with example review ids, then write reviews/themes.md tying each theme to evidence.
- Budgets: about 8 searches, 15 pages. This area usually needs the browser first — coordinate with the main agent so only one area uses it at a time.
