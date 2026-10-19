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
Scripts: `dev` `build` `start` `lint` `typecheck` `test` `db:generate` `db:migrate` `smoke:real`

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
