# Website (kardata.co)

The public site: the weekly blog, a way to book a 20-minute call, and later the brainstorming agent (D-51). It is a
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

## Deploying (to be settled in the first website plan)

The switch to the new site is one edit to the `kardata.co` block in the Caddyfile, then a Caddy reload. The old site
stays up until then.
- **Static site (recommended for the blog):** build to files locally, copy them to a folder on the VM that the Caddy
  container can read, and serve them with `file_server`.
- **Server app (if a page needs one):** build an `linux/arm64` image locally or in CI, push it to
  `ghcr.io/karthikkode/`, pull and run it on the VM on `kathawin-edge` under a new alias (not `kardata-web`), and
  point the block at it.

## Rules for the VM

- kathawin.com runs on the same VM and Caddy. Never restart, rebuild or stop kathawin containers.
- Back up the Caddyfile before editing it, and validate it before reloading.
- No secrets in this folder or in the repo. No prospect data on the site (D-09).
- Every change on the VM needs the owner's explicit go.
