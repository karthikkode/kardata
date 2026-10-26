# Website (kardata.co)

The public site: the weekly blog, a way to book a 30-minute call, and later the brainstorming agent (D-51). It is a
separate project from `kardata-server` and shares no code, database or secrets with it.

- `frontend/`: the site itself (blog and pages).
- `backend/`: empty until a server-side feature needs it (the agent, D-51).

What the site says and sells comes from `docs/business/content.md` (audience, the shape of a blog piece, writing
rules) and `docs/business/offer.md`. The current website plan is the file in `docs/plans/website/` whose first line
is `Status: current`.

## Hosting (checked 2026-10-27, read-only)

- **VM:** Oracle Cloud free tier, `kathawin-prod`, VM.Standard.A1.Flex (**ARM64**), Oracle Linux 9.7, region
  `ap-hyderabad-1`. SSH as `opc` with `~/.ssh/kathawin_ci_vm`. The OCI CLI is set up locally (`~/.oci/config`).
- **DNS:** kardata.co and www.kardata.co point at the VM's public IP.
- **HTTPS and routing:** one Caddy container, `kathawin-caddy-1`, owned by the kathawin project, serves every site on
  the VM. Its config is `~/kathawin/deploy/Caddyfile`. The `kardata.co` block currently proxies to `kardata-web:3000`
  over the Docker network `kathawin-edge`; `www.kardata.co` redirects to the apex.
- **What runs there today:** the old v1 Kardata stack in `~/kardata` (web, api, db, mail-watchdog,
  review-supervisor), copied over without git and built on the VM. The new site replaces its `web` container; whether
  the rest of v1 is shut down is the owner's call.
- **Disk:** 28 of 30 GB used (94%). Don't build images on the VM until space is cleared.

## Deploying (plan: `docs/plans/website/site-1-launch.md`)

kathawin's Caddy mounts only its Caddyfile, so it can't serve a host folder without re-creating a kathawin
container. Instead a small container of our own, `kardata-site` (`deploy/compose.yml`, the `caddy:2-alpine` image
already on the VM), serves `/home/opc/kardata-site/current` on `kathawin-edge`. kathawin's Caddy keeps TLS and
proxies kardata.co to it.

- **Build and check:** `cd frontend && npm run check`. Never build on the VM.
- **Deploy:** `npm run deploy` refuses a dirty `website/`, builds, uploads a release to
  `~/kardata-site/releases/<date>-<commit>`, switches `current` atomically and keeps 5. `npm run rollback` goes back
  one. `DEPLOY_HOST=local DEPLOY_ROOT=<dir>` runs both on this machine for testing.
- **First time on the VM:** copy `deploy/compose.yml` to `~/kardata-site/` and run
  `docker compose -p kardata-site up -d` there.
- **Switch kardata.co** (only on the owner's word): back up the Caddyfile, change `reverse_proxy kardata-web:3000`
  to `reverse_proxy kardata-site:80` in the `kardata.co` block, validate the new file inside the container, write it
  over the Caddyfile in place (`cat new > Caddyfile`; it is a single-file bind mount, so `sed -i` would leave Caddy on
  the old copy), then `docker exec kathawin-caddy-1 caddy reload --config /etc/caddy/Caddyfile`. Roll back the
  same way from the backup.

## Rules for the VM

- kathawin.com runs on the same VM and Caddy. Never restart, rebuild or stop kathawin containers.
- Back up the Caddyfile before editing it, and validate it before reloading.
- No secrets in this folder or in the repo. No prospect data on the site (D-09).
- Every change on the VM needs the owner's explicit go.
