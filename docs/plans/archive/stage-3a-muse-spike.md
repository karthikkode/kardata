Status: done · Date: 2026-10-26

# Stage 3a — Muse harness spike

**Goal:** prove, with evidence, how `kardata-server` can launch and control Muse as a research agent before
we build the orchestrator. This is a **spike**: answer the questions below with real runs, build only a
thin adapter prototype, then STOP. The Stage 3b orchestrator plan is written from your answers.

Installed: **Muse Code 1.4.10**, model `muse-spark-1.3`, contributor mode on.

What `--help` and a test run already showed:
- `muse exec` runs headless, with `--json` JSONL events, `--prompt-file`, `--session-id` and
  `--max-model-steps`.
- Flags exist to remove shell and file writes: `--disable-shell`, `--disable-write`.
- There's a `--permission-profile`, `--approval-mode untrusted|on-request|never` and `--approval-judge`.
- `-c KEY=VALUE` sets config per run; secrets only as a whole-value `${VAR}`.
- MCP servers are configured under `mcpServers`, as stdio or streamable-http.
- Built-in tools include `web_search`, `web_fetch` and `workflow` (subagents). **There is no browser tool.**

**Out of scope:** the orchestrator, queueing, per-run tokens, the research playbook. Use the operator token
(through an env var) for the spike only.

## Step 0 — News query fix (small)

GDELT rejects the bare domain term. Query only the **quoted company name**, and keep the local filter on title
or URL containing the name or domain. Test the exact query string. Don't probe GDELT live more than once.

## Step 1 — Answer these questions with real runs

Use a throwaway workspace per run under `var/runs/<runId>/`. Write a small `scripts/spike-muse.ts` that
launches Muse through `child_process.spawn`, never through a shell string.

1. **Launch and events:**
   - the exact working command line;
   - which JSONL event types arrive, and which carry the session id, tool calls, tool results, final answer
     and errors;
   - exit codes for success, error and kill.
2. **Per-run MCP config:** attach, for one run only, without editing `~/.config/muse/settings.json`:
   - **kardata MCP** (streamable-http, Bearer token from an env var through `${VAR}`);
   - **Playwright MCP**: Microsoft's `@playwright/mcp`, pinned as a devDependency, headless, `--isolated`
     (fresh profile, no persistence).

   Prove the agent can call a kardata tool (`company_context`) and a browser tool (navigate plus snapshot a
   fake-site page).
3. **Lockdown:**
   - with `--disable-shell --disable-write`, plus whatever approval mode/profile lets MCP tools run unattended,
     prove the agent **cannot** run a shell command or write a file (ask it to try; show it fails);
   - prove that kardata MCP, Playwright MCP, `web_search` and `web_fetch` **do** work with no human prompt.

   Does the user's global `:unrestricted` profile leak into the run? Find the flag or profile that makes a
   run independent of the global settings.
4. **Subagents:**
   - can the main agent spawn subagents headless (delegation said "unavailable: workspace is untrusted"; does
     `--trust-workspace` or config fix it)?
   - do subagents inherit the run's MCP servers and lockdown?
   - can a subagent label be seen in events, so we can set `created_by agent:<run>/<label>`?
5. **Web search quality:** on 10 real companies from the dev DB, run the same 3 queries each
   (`"<name>" reviews`, `"<name>" news`, `"<name>" funding OR raises`) through Muse `web_search`.
   - Report per query: results returned, and whether ≥ 1 result is clearly about this company (judge by
     the domain or name in the URL/title).
   - Report rate limits or failures verbatim.
   - Counts only in the review, plus C-labels.
6. **Stop and clean up:**
   - SIGTERM, then SIGKILL after 10 s: does Muse exit, and do its child processes (Playwright MCP, Chromium)
     die too? Show `ps` before and after.
   - Does the file-descriptor leak still happen (count open fds over a 10-minute run)?
7. **Resources:** peak RSS of one run with Muse + Playwright + Chromium; then 3 runs at once. Recommend
   `MAX_CONCURRENT_AGENTS`.
8. **Limits and usage:** does `--json` or `muse trace` report token/usage per run? Hitting the subscription
   limit: which error, which event? A run-length cap: `--max-model-steps` behavior when reached.
9. **Liveness:** which events can serve as a heartbeat? How long can Muse go silent during a long model step?
   That sets the stall timeout.

## Step 2 — Adapter prototype

`src/harness/types.ts` defines the interface Stage 3b will use, so another harness could replace Muse later:

```
start({runId, workspaceDir, prompt, mcpServers, env, limits}) → handle
handle.events (async iterator of normalized events: started | tool_call | tool_result | message |
               subagent | usage | error | finished)
handle.stop(reason)
handle.wait() → {exitCode, finalMessage, usage?}
```

`src/harness/muse.ts` implements it with what Step 1 proved. One integration test is marked `@live` and
excluded from CI/default `npm test`: run a 3-step prompt against a fixture company, then assert the events
and that the agent wrote one document through kardata MCP.

## Review and stop

Write `docs/reviews/stage-3a-spike.md`, max 80 lines:
- for each of questions 1–9: the answer, plus the evidence (command, event excerpt or measurement);
- the recommended flags and config for research runs;
- `MAX_CONCURRENT_AGENTS`, the stall timeout, and the search hit rate;
- **blockers or surprises that change the Stage 3b design.**

Then STOP.
