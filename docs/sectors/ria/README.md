# RIA (US registered investment advisers)

Status: active (D-69, 2026-10-31) · Slug `ria-us` · Playbook `ria`

Wealth management firms registered with the SEC. They charge clients a yearly percentage of the assets they
manage, billed quarterly; most of their cost is people. What we sell: fixing manual operations work and revenue
leaks. Fee billing (wrong fee schedules, missed family discounts, caps never entered, prepaid fees not refunded,
accounts never billed) is the clearest example; onboarding paperwork that comes back, data typed into several
systems and client requests stuck in inboxes are others.

- Source: the SEC's monthly investment adviser file (public; every SEC-registered adviser). Firm facts, assets
  under management, staff, client types, main phone. Requests to SEC sites carry `User-Agent: Kardata
  karthik@kardata.co` and stay under 10 per second.
- Each firm's Form ADV Part 2A brochure (fees and billing, Item 5) and Part 1 (executive officers in Schedule A,
  custodians, disclosures) on adviserinfo.sec.gov.
- ICP: [icp.md](icp.md). Decisions: [decisions.md](decisions.md).
- Background, terms and call practice live in `hedge/ria/` in the owner's checkout (not on main): primer, business
  model, bottlenecks, fee-check design. Read them if they are present; they are not required.

No prospect names, people, emails or phones in this folder. They stay in the database.
