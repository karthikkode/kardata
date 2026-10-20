# kardata-server (v2)
Backend-only MCP service. No frontend.

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

Agent runs reach kardata MCP at `host.docker.internal:<PORT>` through the
Docker bridge, so the server must listen on `0.0.0.0` (set `HOST=0.0.0.0` in
`.env`) for agent runs. Postgres stays loopback-only (see
`docker-compose.yml`), so containers cannot reach it.

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
