#!/usr/bin/env bash
# kardata-agent entrypoint. Modes: setup | version | run.
# run execs the app-owned Muse with the given args (research runs only).
set -euo pipefail

MUSE_DIR="${MUSE_DIR:-/opt/muse}"
MUSE_BIN="$MUSE_DIR/bin/muse"
export HOME="${HOME:-/opt/muse/home}"
export MUSE_NO_AUTO_UPDATE=1
LAUNCHER_URL="https://api.meta.ai/muse-launcher.sh"

die() { printf 'entrypoint: %s\n' "$*" >&2; exit 1; }

cmd="${1:-}"
case "$cmd" in
  setup)
    # Runs as root in the setup container: installs the launcher + binary into
    # the volume, performs the device-code login as the app identity, then
    # hands the whole tree to the agent user research runs use.
    [[ "$(id -u)" == "0" ]] || die "setup must run as root (it chowns the volume)"
    [[ -t 0 ]] || die "setup needs a terminal (run npm run harness:setup interactively)"
    mkdir -p "$MUSE_DIR/bin" "$HOME"
    curl -fsSL --max-time 120 "$LAUNCHER_URL" -o "$MUSE_BIN"
    chmod +x "$MUSE_BIN"
    MUSE_LAUNCHER_INSTALL=1 "$MUSE_BIN"
    "$MUSE_BIN" login
    chown -R agent:agent "$MUSE_DIR"
    echo "entrypoint: app Muse ready: $("$MUSE_BIN" --version)"
    ;;
  version)
    [[ -x "$MUSE_BIN" ]] || die "app Muse is not installed (run npm run harness:setup)"
    exec "$MUSE_BIN" --version
    ;;
  run)
    [[ -x "$MUSE_BIN" ]] || die "app Muse is not installed (run npm run harness:setup)"
    shift
    [[ "$#" -gt 0 ]] || die "usage: entrypoint.sh run <muse args...>"
    exec "$MUSE_BIN" "$@"
    ;;
  *)
    die "usage: entrypoint.sh {setup|version|run}"
    ;;
esac
