# Site 1 review: kardata.co, built locally

Branch `website/base` (worktree `~/projects/kardata-website`, cut from `main`). Plan: `docs/plans/website/site-1-launch.md`
(still `Status: draft`; the owner said to build locally first). Steps 1 to 6 are done and committed one per step.
Step 7 (go-live) has not started: it needs the owner's go. Nothing on the VM was changed; I only ran read-only `ssh` checks
and copied v1's photo down.

## Acceptance criteria

| Criterion | Where | Evidence |
|---|---|---|
| Builds on an empty site, pinned deps | `website/frontend/package.json` | Step 1 build; `npm audit`: 0 vulnerabilities |
| v1 look (palette, Inter + JetBrains Mono, K mark, mono eyebrows) | `src/styles/global.css:2`, `src/components/LogoMark.astro` | Screenshots in the session, desktop and 375px |
| Meta, canonical, OG and Twitter tags on every page | `src/layouts/Base.astro:20`, `src/lib/seo.ts` | `tests/seo.test.ts`; `public/og-default.png` 1200×627 |
| Posts in Markdown, schema checked at build | `src/content.config.ts` | `astro check` 0 errors |
| Sources, number kinds, synthetic notice | `astro.config.mjs` (footnotes as "Sources"), `src/lib/remark-number-kinds.mjs`, `src/components/SyntheticNotice.astro` | `tests/remark-number-kinds.test.ts` (unknown kind fails); sample post viewed in dev |
| Drafts never ship; RSS only has published posts | `src/lib/posts.ts`, `scripts/check-dist.mjs:43` | `tests/posts.test.ts`; check-dist draft guard passes with the sample as a draft |
| Every post ends with the audit line and the button | `src/pages/blog/[...slug].astro:38` | Sample post |
| Home copy word for word from website.md | `src/pages/index.astro` | `tests/home-copy.test.ts` compares the built page with website.md (run with `WEBSITE_MD=…/kardata/docs/business/website.md`) |
| Pages: home, audit, blog, post, about, book, contact, privacy, 404 | `src/pages/` | 8 pages built, plus posts |
| Never on the site: em dash, "diagnostic", "AI automation", `$` amounts, guarantee, retainer, testimonials | `scripts/lib/scan.mjs` | `tests/check-dist.test.ts`; `npm run check` passes |
| No broken internal links or anchors | `scripts/lib/links.mjs` | `tests/check-dist.test.ts`; `npm run check` passes |
| Accessibility and mobile | skip link, focus ring, `<details>` menu with no JS, alt text required by the schema | No horizontal scroll at 375px |
| Deploy: atomic release, keep 5, rollback, refuses a dirty tree | `website/deploy/deploy.sh`, `rollback.sh` | Run locally against a `caddy:2-alpine` container: 200 on pages, 308 `/blog`→`/blog/`, 301 for v1 routes, custom 404, immutable cache on `/_astro/*`, rollback, dirty refusal |

Full run at the end: `npm run check`: astro check 0 errors, 8 pages, check-dist OK, 23 tests passed.

## Deviations

- **Extra dependency** `@astrojs/markdown-remark` 7.3.2: Astro 7's new default Markdown engine takes no plugins. It's
  named in the plan now.
- **vitest 4.1.12**, not 4.0.x: the older version had a published advisory. npm 10 crashes on its peer set
  (`edgesOut`), so I installed with `npx npm@11.6.2 install`.
- **Audit-type table → cards** on `/audit`: the table was unreadable at 375px.
- **No hero fade-in**: when animation stalls, the hero text stays invisible.
- **Prune bug fixed in testing**: after a rollback, pruning could delete the live release. It now always keeps `current`.
- **"From the blog" is hidden while there are no published posts**, so the live home page has no empty section.
- **Copy I wrote outside the docs (please check):** the footer line, the blog page's intro line, the synthetic
  notice, `/book`'s "Times show in your own time zone", the `/audit` framing sentences (from offer.md in "I" voice), and the
  privacy draft.

## Owner feedback, 2026-10-27 (applied)

- New photo (`~/Downloads/my_pics/karthik.png`): a face crop for the round avatar, the full portrait on `/about`.
- Headline "five systems" → "multiple systems". `tests/home-copy.test.ts` holds this as an owner change
  until website.md says the same.
- v1's founder card is back (`src/components/FounderCard.astro`) with v1's own text. `/about` uses v1's "Who I am" text
  and its four pillars.
- No placeholders left except the empty blog. The audit page has no data-handling placeholder now. Privacy says Calendly,
  no analytics, and "kept as long as needed, deleted on request" (my wording; please check).

## Open (owner)

1. **Booking is Cal.com** (owner, 2026-10-27; `src/config.ts`, official inline embed, dark theme, site blue). The
   event `karthik-kardata-iaygkj/30min` is 30 minutes: set it to 20 and add website.md's questions in Cal.com.
2. **Analytics:** none on the site. Choosing one (Plausible or Umami Cloud) also means updating `/privacy`.
3. **Copy flags (not rewritten):** home "fix the ones worth fixing" against D-53/D-58; content.md "No call to action"
   against website.md's post button; strategy.md "one case study live" against website.md "later".
4. **Deploy A or B**, and whether any v1 `/p/...` links still matter. website.md needs the "multiple systems" edit.

## Blocked

Nothing.
