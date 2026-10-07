FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN pnpm install --frozen-lockfile --filter backend... --ignore-scripts

COPY backend backend
WORKDIR /app/backend
RUN pnpm exec prisma generate && pnpm exec tsc

EXPOSE 3000
CMD ["node", "--env-file-if-exists=.env", "dist/index.js"]
