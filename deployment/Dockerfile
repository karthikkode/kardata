# Backend runtime. Build from the repo root:
# docker build -f deployment/Dockerfile -t kardata-backend:dev .
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY agents/package.json agents/package.json
COPY backend/package.json backend/package.json
RUN npm ci
COPY backend/src backend/src
COPY backend/tsconfig.json backend/tsconfig.build.json backend/
COPY agents/src agents/src
COPY agents/tsconfig.json agents/tsconfig.build.json agents/
RUN npm run build --workspace agents
RUN npm run build --workspace @kardata/backend

# Debian/glibc runtime: the Temporal core-bridge native module links glibc.
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package.json
COPY agents/package.json agents/package.json
COPY backend/package.json backend/package.json
RUN npm ci --omit=dev
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/agents/dist agents/dist
COPY db/migrations db/migrations
COPY deployment/backend-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
EXPOSE 3001
ENTRYPOINT ["/entrypoint.sh"]
