# kardata-server (v2)
Backend-only MCP service. No frontend.

Docs: stage plans in `docs/plans/`, reviews in `docs/reviews/`, code how-tos in `docs/sources/`, and the business
side (strategy, offer, ICP, outreach) in [`docs/business/`](docs/business/README.md). Agent rules: `AGENTS.md`.

## Run

Requires Node 22 (`nvm use 22`) and Docker.

```sh
cp .env.example .env   # set KARDATA_OPERATOR_TOKEN
npm ci
docker compose up -d
npm run db:migrate
npm run dev            # health: GET /healthz
```
Scripts: `dev` `build` `start` `lint` `typecheck` `test` `db:generate` `db:migrate` `smoke:real` `harness:setup`
`mcp` calls one tool on a running server (`npm run mcp -- <tool> '<json>'`).

## Run vs dev

The pipeline runs ONLY from built code under the systemd unit, on the main
DB (`kardata`), port 8787. Development and tests never touch it:

- prod: the `kardata-server` service runs `node dist/server.js` from the
  dedicated live checkout `~/kardata-live` (a clone, always on main, with
  its own `.env`). Deploy with `scripts/deploy-live.sh` (drain deploy by
  default: freezes promotion, waits for live jobs to finish, then
  restarts; `--force` pauses them first and resumes after instead).
  Never develop in the live checkout.
- dev: `npm run dev` (tsx watch) with `.env.dev` (create it from
  `.env.example`: `kardata_dev` DB, port 8788, own operator token).
  `npm run dev:migrate` migrates `kardata_dev` (+ `kardata_test`).
- tests use `kardata_test` in both files.

All pipeline operations go through MCP tools (`npm run mcp -- …`, prod URL
and token from `.env`); nothing runs ad-hoc against the database.

## Agent harness (app-owned Muse)

Research agents run inside the `kardata-agent` image with an app-owned Muse
login stored in the `kardata_muse` volume — never the owner's personal Muse.
One-time, interactive:

```sh
npm run harness:setup   # build + install launcher + `muse login` (device code); writes KARDATA_MUSE_VERSION to .env
```

`kardata-server` checks the installed version at boot and refuses to start
agent runs when it differs from `KARDATA_MUSE_VERSION`. Re-run `harness:setup`
to upgrade (it rewrites the pin after a successful login).

Agent containers live on a dedicated Docker network (`kardata_agents`,
`172.31.250.0/24`, created by `harness:setup`) and reach kardata MCP at the
network gateway (`http://172.31.250.1:<PORT>/mcp`). The server listens on
`127.0.0.1` and the gateway only (`HOST=127.0.0.1,172.31.250.1` in `.env`),
never `0.0.0.0`, so it is not reachable on LAN/Tailscale addresses. Postgres
stays loopback-only (see `docker-compose.yml`), so containers cannot reach it.

## Register the MCP server

Claude Code:

```sh
claude mcp add --transport http kardata http://127.0.0.1:8787/mcp --header "Authorization: Bearer <token>"
```

Muse: add to `~/.config/muse/settings.json`:

```json
{"mcpServers": {"kardata": {"url": "http://127.0.0.1:8787/mcp", "headers": {"Authorization": "Bearer <token>"}}}}
```

## Service (systemd user unit)

```sh
npm run build
cp scripts/kardata-server.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now kardata-server.service  # logs: journalctl --user -u kardata-server
```
