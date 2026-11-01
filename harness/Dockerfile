# kardata-agent: sandbox for app-owned Muse research runs.
#
# No Muse binary in the image: `npm run harness:setup` installs the launcher
# and binary into the kardata_muse volume, where the app login lives too.
# Research runs use --user agent (uid 10001, pinned so run mounts can map it).
FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/opt/browsers \
    NODE_PATH=/usr/local/lib/node_modules \
    LANG=C.UTF-8

# curl + ca-certificates for the Muse launcher; chromium + OS libs for
# Playwright MCP (browser build resolved from the pinned package's own core);
# cheerio (pinned to the repo's version) for the on-site reviews job parser.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates bash \
  && npm install -g @playwright/mcp@0.0.83 \
  && npm install -g cheerio@1.2.0 \
  && CORE_CLI="$(find /usr/local/lib/node_modules/@playwright/mcp -path '*/playwright-core/cli.js' | head -n 1)" \
  && test -n "$CORE_CLI" \
  && node "$CORE_CLI" install --with-deps --no-progress chromium chrome \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/*

RUN groupadd -g 10001 agent \
  && useradd -u 10001 -g agent --create-home --shell /bin/bash agent \
  && mkdir -p /opt/muse /workspace /opt/muse/home \
  && chown -R agent:agent /opt/muse /workspace /opt/browsers

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY usage-reader.mjs /usr/local/bin/usage-reader.mjs
COPY session-reader.mjs /usr/local/bin/session-reader.mjs
COPY session-cleanup.mjs /usr/local/bin/session-cleanup.mjs
COPY reviews.mjs /usr/local/bin/reviews.mjs
RUN chmod +x /usr/local/bin/entrypoint.sh

USER agent
ENV HOME=/opt/muse/home \
    MUSE_NO_AUTO_UPDATE=1
WORKDIR /workspace
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["version"]
