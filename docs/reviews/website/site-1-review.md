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

## Open (owner)

1. **Booking tool:** `/book` uses v1's Calendly `new-meeting` event, which is 30 minutes and has no intake questions.
   Choose Cal.com or Calendly (plan, "Booking tool") and send a 20-minute event URL; it's one line in `src/config.ts`.
   The embed and booking event are unverified, because the preview pane blocks third-party frames.
2. **Analytics tool:** `track()` is a stub until you choose (Plausible or Umami Cloud recommended).
3. **About text and photo** (placeholder). **Who's behind it** paragraph on home (placeholder).
4. **Data handling on `/audit`** (storage, access, deletion) and the **privacy retention period**: not in
   docs/business, so they're left as placeholders.
5. **Copy flags (not rewritten):** home "fix the ones worth fixing" against D-53/D-58; content.md "No call to action"
   against website.md's post button; strategy.md "one case study live" against website.md "later".
6. **Deploy A or B**, and whether any v1 `/p/...` prospect links still matter (they 404 after the switch).
7. `website/README.md` here is your uncommitted copy from the stage-5.3 checkout plus my "Deploying" section. The
   AGENTS.md "Website" section and `docs/business/website.md` are still uncommitted in that checkout.

## Blocked

Nothing.
