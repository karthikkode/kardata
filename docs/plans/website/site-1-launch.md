Status: draft · Date: 2026-10-27

# Site 1: launch kardata.co

Build the new kardata.co as a static site in `website/frontend/`, run it locally, then deploy it next to the v1
site and switch over when the owner says so. Requirements are `docs/business/website.md` (D-57, D-58, D-59). Rules
are in AGENTS.md ("Website") and `website/README.md`.

Out of scope: the brainstorming agent (D-51), case studies, the newsletter. `website/backend/` stays empty.

## Stack

| Package | Why |
|---|---|
| `astro` 7.3.8 | Static site generator. Markdown pages are built in, posts are checked against a zod schema at build, and it ships zero JavaScript by default. Needs Node 22.12+ (local is 22.23.3) |
| `@astrojs/markdown-remark` | Astro 7's default Markdown engine takes no plugins; this official package runs the number-kind plugin and the footnote sources |
| `@astrojs/rss` | `/rss.xml` from the posts |
| `@astrojs/sitemap` | `sitemap-index.xml` for search engines |
| `@fontsource-variable/inter`, `@fontsource/jetbrains-mono` | v1's fonts, served from our own domain. Loading them from Google Fonts would send visitors' IPs to Google |
| dev: `@astrojs/check`, `typescript` | `astro check` type-checks pages and front matter |
| dev: `vitest` | Unit tests for the Markdown plugin and the checks |

**No Tailwind and no UI framework.** v1's tokens (colours, radii, fonts) become CSS variables in one stylesheet.
There's no React and no client-side framework; the only scripts are the mobile menu fallback (none needed: it uses
`<details>`), the booking embed and the analytics snippet.

Why static: nothing in v1 of the site needs a server. Posts are files, booking and analytics are hosted tools, and
there are no forms of our own. The output is a few MB of files, built on the laptop, so the VM's full disk doesn't
matter and no image is built or pulled. A server arrives only with the agent (D-51).

## Pages and components

| Route | Content | Copy source |
|---|---|---|
| `/` | The 8 home sections, in order | `website.md`, **word for word** |
| `/audit` | What it answers (the 3 audit types), what you get (the 5 deliverables), how it runs, what I need, how data is kept safe | `offer.md` audit section, "we" changed to "I". Marked draft for owner sign-off |
| `/blog` | Posts newest first: date, title, summary | Owner |
| `/blog/<slug>` | One post | Owner |
| `/about` | Real photo (v1's `karthik.web.jpg`), background, insurtech work, LinkedIn link | **Placeholder** until the owner writes it (D-44) |
| `/book` | The 30-minute call (D-60), the booking embed, a "open in a new tab" fallback, the email | Short, from `website.md` |
| `/contact` | The contact email and LinkedIn | Plain |
| `/privacy` | What is collected (booking details, analytics), by whom, how long, how to ask for deletion | Draft from the actual tools, for the owner to approve |
| `404` | Links home and to the blog | Plain |

Components: `Header` (logo, nav, "Book a call" button; a `<details>` menu on mobile), `Footer`, `SectionHeading`
(mono eyebrow + title, as v1), `BookButton` (links to `/book?from=<page>`), `PostCard`, `KindLabel`,
`SyntheticNotice`, `FAQ` (`<details>` items).

**Never on the site** (checked by a test over the built HTML): prices or `$` amounts in our copy, guarantee figures,
retainer or build offers, testimonials, client logos, stock or AI images, chat widgets, pop-ups, prospect names,
"diagnostic", "AI automation" and em dashes. "I", not "we" is checked by eye: the FAQ quotes owners saying "we".

## Blog posts: Markdown files, no CMS

A CMS would mean a server or a third-party service for one author who writes in a text editor anyway.

1. Copy `src/content/posts/_template.md` to `src/content/posts/<slug>.md`. Front matter: `title`, `date`,
   `summary` (one line, used on `/blog`, RSS and link previews), `synthetic` (true or false), `draft` (true until
   it's ready), and an optional `image` for the link preview.
2. **Sources:** standard Markdown footnotes, `claim[^1]` and `[^1]: [Title](url), publisher, year.` They render as a
   numbered **Sources** list at the end, with links back to the text.
3. **Number kinds:** write `{study}`, `{claim}`, `{vendor}` or `{estimate}` right after a number. It renders as a
   small label ("study", "company claim", "vendor data", "estimate"). A small plugin of our own (no dependency)
   does this; unknown kinds fail the build.
4. **Synthetic business:** `synthetic: true` puts a visible notice at the top of the post.
5. The layout ends every post with the quiet audit line ("This is what I look for in an audit.") and the booking
   button, so the owner doesn't repeat them.
6. `npm run dev` shows drafts (with a "Draft" badge). The production build never includes them.
7. `npm run check` (types, build, internal links, the "never on the site" scan), commit, and deploy.

One **sample post** (`sample-post.md`, `draft: true`, labelled "Sample" in its title and body) shows every feature.
It never reaches the live site.

## Link previews and RSS

Every page has a title, description, canonical URL, Open Graph and Twitter tags. LinkedIn reads `og:title`,
`og:description` and `og:image`. There's one default preview image (1200×627 PNG: the logo and "kardata.co" on the
site background, no photo or AI art); a post can set its own `image`. RSS is at `/rss.xml` and is linked in the
`<head>`. After deploy, check a post in LinkedIn's Post Inspector.

## Accessibility and mobile

Semantic headings in order, a skip link, visible focus rings, alt text required in the schema for any post image,
text contrast at least 4.5:1 on v1's dark palette, `prefers-reduced-motion` respected, tap targets at least 44px,
a layout that works from 360px wide with no horizontal scroll, and the menu works without JavaScript.

## Booking tool (owner chooses)

Needs: 30 minutes (D-60); asks name, email, company website, where they sell (own site, Amazon, retailers, other) and one
optional line; shows times and sends confirmations in the visitor's time zone; can tell our analytics a booking
happened.

| Option | For | Against |
|---|---|---|
| **Cal.com** (free plan) | Custom questions, including a multi-select for "where they sell". Times and emails in the visitor's zone. An inline embed with a "booking successful" event | New account to set up |
| **Calendly** (current account, free plan) | Already set up (v1 uses it). Inline embed with a "scheduled" event. Times in the visitor's zone | One event type on the free plan; the current one is 30 minutes. Whether the free plan allows all 4 custom questions needs checking |
| Google Calendar appointment schedules | No new vendor | Custom booking questions need paid Workspace; no event for analytics |

**Chosen: Cal.com** (D-61).

## Analytics tool (owner chooses)

Needs: no cookies (so no banner), no ad pixels, counts bookings with the page they came from, and counts post
visits. No personal data in URLs; `?from=` only ever holds our own page path.

| Option | For | Against |
|---|---|---|
| **Plausible** (hosted) | Cookieless, custom events with properties (`booked`, `from`), simple dashboard, EU-hosted | Paid (monthly plan) |
| **Umami Cloud** | Cookieless, custom events with properties, free hobby tier | Free tier limits; self-hosting would need a database on the full VM |
| GoatCounter | Cookieless, free, tiny | Events are page-path counters; "booked from" works but reads crudely |
| Cloudflare Web Analytics | Free, cookieless | No custom events, so it can't count bookings by page |

**Recommendation: Plausible** if a small monthly fee is fine, else **Umami Cloud**. Until chosen, the site calls a
`track()` stub that does nothing.

## Build locally

`cd website/frontend && npm install && npm run dev` (http://localhost:4321). `npm run check` before every deploy.
`npm test` runs the unit tests. Node 22 (`.nvmrc`). Root lint, typecheck and tests ignore `website/`.

## Deploy path (VM steps only with the owner's go)

Read-only check, 2026-10-27: `kathawin-caddy-1` mounts only its Caddyfile and its `/data` and `/config` volumes.
It can't read a host folder without a new mount in kathawin's compose, which means re-creating a kathawin
container. That is ruled out. So "through the existing Caddy" means it keeps TLS and routing, and the files come
from one of these (owner chooses):
- **A (recommended):** a tiny container of our own, `kardata-site`, from the `caddy:2-alpine` image already on
  the VM (no pull). It runs on `kathawin-edge` under that alias, serves `/home/opc/kardata-site/current` read-only,
  and is defined in `website/deploy/compose.yml` as its own compose project. kathawin's Caddy proxies to it.
- **B:** copy the files into the `kathawin_caddy_data` volume and serve them with `file_server` from the existing
  container. No new container, but our files would live in kathawin's certificate volume.

Steps (A):
1. Build on the laptop: `npm run check`. Deploy refuses a dirty tree.
2. `npm run deploy` uploads `dist/` with rsync to `~/kardata-site/releases/<date>-<commit>`, switches `current`
   atomically (`ln -s` + `mv -T`), keeps 5 releases, and smoke-tests. `npm run rollback` goes back one.
3. First time only: `docker compose -p kardata-site up -d` and a check from inside the network:
   `docker exec kathawin-caddy-1 wget -qO- http://kardata-site/`. kardata.co still serves v1.
4. **Switch, only when the owner says so:**
   - back up the Caddyfile: `cp Caddyfile Caddyfile.bak-<timestamp>`;
   - write the new version to a temp file, with one line changed in the `kardata.co` block:
     `reverse_proxy kardata-web:3000` → `reverse_proxy kardata-site:80`;
   - `docker cp` it into the container and run `caddy validate` there;
   - write it over the Caddyfile **in place** (`cat new > Caddyfile`), because a single-file bind mount keeps the
     old copy if `sed -i` or an editor replaces the file;
   - `docker exec kathawin-caddy-1 caddy reload`, a graceful reload with no restart. kathawin.com stays up, and
     Caddy keeps the old config if the new one is rejected;
   - check kardata.co, www → apex, kathawin.com, its staging site and mm.kardata.co.
5. Rollback: write the backup back in place and reload. v1 keeps running until the owner retires it.
6. v1 links: `/how-it-works`, `/ai-layer`, `/case-studies` redirect to `/`. v1's `/p/...` prospect pages stop
   working (see the questions below).

## Steps, acceptance criteria and tests

| # | Step | Done when | Tests |
|---|---|---|---|
| 1 | Scaffold `website/frontend` with pinned deps, `.nvmrc`, `website/` in the root eslint ignores | `npm run build` passes on an empty site | Build runs |
| 2 | Tokens, fonts, layout, header, footer, SEO head | Pages share v1's look; meta and OG tags on every page | Unit test of the SEO helper |
| 3 | Posts: schema, `_template.md`, kind-label plugin, footnote sources, synthetic notice, `/blog`, post page, RSS, sitemap, sample post | Sample renders every feature in dev; drafts are absent from `dist/` | Plugin unit tests; a build test that no draft is in `dist/` and RSS lists only published posts |
| 4 | Home (word for word), `/audit`, `/about` placeholder, `/book`, `/contact`, `/privacy`, `404` | Every page has one path to `/book` | Test: home text matches `website.md` lines |
| 5 | `npm run check`: link checker and the "never on the site" scan | Fails on a broken link, an em dash, "diagnostic", a `$` amount | Unit tests for both scanners |
| 6 | `website/deploy/` (compose, site Caddyfile, `deploy.sh`, `rollback.sh`), README "Deploying" updated | Deploy and rollback work against a local container of the same image | Local run log in the review |
| 7 | Go-live on the VM | **Only with the owner's explicit go** | Checks in step 4 above |
| 8 | Review `docs/reviews/website/site-1-review.md` (≤ 80 lines) | | |

## Open (owner): what blocks me

- **Booking tool** and **analytics tool**: needed to finish `/book` and tracking (step 4). I build with the stub
  and the v1 Calendly link until then.
- **About text and photo**: the page ships with a marked placeholder. Is v1's photo still the one to use?
- **Mission line**: website.md asks whether to keep it off the home page or drop it. I leave it out.
- **Call length**: settled at 30 minutes everywhere (D-60).
- **Deploy A or B**, and whether any v1 `/p/...` prospect links were sent that still matter.
- **Copy to check** (I won't rewrite it):
  - home line 1 ends "and fix the ones worth fixing", while D-53/D-58 say the site sells the audit, never the
    fix. D-59 may cover it ("general about the fix"); please confirm;
  - `content.md` says a blog piece has "No call to action", while website.md says every post ends with the booking
    button. I follow website.md;
  - `strategy.md` wants "one case study live on kardata.co" before the first send, while website.md puts case
    studies "later, not v1";
  - `offer.md` still says "diagnostic" in places; on `/audit` I use "audit" (D-54).
