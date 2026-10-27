# Website (kardata.co)

The public site: the weekly blog, a way to book a 30-minute call, and later the brainstorming agent (D-51). It is a
separate project from `kardata-server` and shares no code, database or secrets with it.

**Status (2026-10-27): live at https://kardata.co.** Astro 7 static site, Node 22. Plan:
`docs/plans/website/site-1-launch.md`; review: `docs/reviews/website/site-1-review.md`.

- `frontend/`: the site itself (blog and pages). `npm run dev` (port 4321), `npm run check` (types, build, link and
  banned-word scan, tests; set `WEBSITE_MD` to `docs/business/website.md` for the ho## Hosting (as of 2026-10-27)

- **VM:** Oracle Cloud free tier, `kathawin-prod`, VM.Standard.A1.Flex (**ARM64**), Oracle Linux 9.7, region
  `ap-hyderabad-1`, IP 140.245.214.119. SSH as `opc` with `~/.ssh/kathawin_ci_vm`. The OCI CLI is set up locally.
- **DNS:** kardata.co and www.kardata.co point at the VM.
- **HTTPS and routing:** one Caddy container, `kathawin-caddy-1`, owned by the kathawin project, serves every site on
  the VM. Its config is `~/kathawin/deploy/Caddyfile`. Its `kardata.co` block proxies to `kardata-site:80` over
  `kathawin-edge`; `www.kardata.co` redirects to the apex. There is no `mm.kardata.co` any more.
- **What of Kardata runs there:** only `kardata-site` (`~/kardata-site`: `releases/`, `current`, `compose.yml`,
  `Caddyfile`). Everything else on the VM is kathawin's: leave it alone.
- **Removed 2026-10-27:** the v1 stack (`~/kardata`: web, api, db, mail-watchdog, review-supervisor, its cron jobs and
  dumps) and Mattermost (`mm.kardata.co`). Both were backed up first to the owner's machine
  (`~/backups/kardata-v1-vm-2026-10-27/`, `~/backups/mattermost-2026-10-27/`), never into the repo.
- **Disk:** about 51% used after cleanup. Still never build images on the VM; the site is built locally.


  the VM. Its config is `~/kathawin/deploy/Caddyfile`. The `kardata.co` block currently proxies to `kardata-web:3000`
  over the Docker network `kathawin-edge`; `www.kardata.co` redirects to the apex.
- **What runs there today:** the old v1 Kardata stack in `~/kardata` (web, api, db, mail-watchdog,
  review-supervisor), copied over without git and built on the VM. The new site replaces its `web` container; whether
  the rest of v1 is shut down is the owner's call.
- **Disk:** 28 of 30 GB used (94%). Don't build images on the VM until space is cleared.

## Deploying

kardata.co is a static site served by one small container, `kardata-site` (`deploy/compose.yml`, image
`caddy:2-alpine`), on the `kathawin-edge` network. kathawin's Caddy keeps TLS and proxies `kardata.co` and
`www.kardata.co` to `kardata-site:80`. Nothing else of Kardata runs on the VM; v1 was removed on 2026-10-27
(its backup is on the owner's machine, not in the repo).

**Deploy:** commit, then from `frontend/`:

```bash
npm run deploy
```

It refuses a dirty `website/`, runs the full check, uploads `~/kardata-site/releases/<date>-<commit>`, syncs
`compose.yml` and the inner `Caddyfile`, starts or updates the container, switches `current` atomically, keeps 5
releases, and fails unless https://kardata.co/release.txt shows the new release.

**Roll back one release:** `npm run rollback` (also checks the live site).

**Test without the VM:** `DEPLOY_HOST=local DEPLOY_ROOT=<dir> npm run deploy`.

**Routing (one-time, already done):** the `kardata.co` block in `/home/opc/kathawin/deploy/Caddyfile` says
`reverse_proxy kardata-site:80`. If it ever needs changing: back it up, validate the new file inside
`kathawin-caddy-1`, write it in place (`cat new > Caddyfile`; it is a single-file bind mount, so `sed -i` leaves Caddy
on the old copy), then `docker exec kathawin-caddy-1 caddy reload --config /etc/caddy/Caddyfile`.

## Rules for the VM

- kathawin.com runs on the same VM and Caddy. Never restart, rebuild or stop kathawin containers.
- Back up the Caddyfile before editing it, and validate it before reloading.
- No secrets in this folder or in the repo. No prospect data on the site (D-09).
- Every change on the VM needs the owner's explicit go.
