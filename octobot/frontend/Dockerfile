FROM node:22-bookworm-slim

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN pnpm install --frozen-lockfile --filter frontend... --ignore-scripts

COPY frontend frontend
WORKDIR /app/frontend
ENV API_PROXY_TARGET=http://backend:3000
RUN pnpm build

EXPOSE 3001
CMD ["pnpm", "start"]
