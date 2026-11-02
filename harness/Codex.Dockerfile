# App-owned Codex extraction only; credentials live in kardata_codex, never the image.
FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && npm install -g @openai/codex@0.166.0 \
  && apt-get clean && rm -rf /var/lib/apt/lists/* \
  && groupadd -g 10001 agent \
  && useradd -u 10001 -g agent --create-home agent \
  && mkdir -p /opt/codex/home /workspace \
  && chown -R agent:agent /opt/codex /workspace
USER agent
ENV CODEX_HOME=/opt/codex/home HOME=/workspace LANG=C.UTF-8
WORKDIR /workspace
ENTRYPOINT ["codex"]
CMD ["--version"]
