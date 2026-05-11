# ─── Stage 1: build ─────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.31.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ─── Stage 2: runtime ───────────────────────────────────────────────
FROM node:20-slim AS runtime

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.31.0 --activate

ENV NODE_ENV=production

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/dist ./dist

EXPOSE 3001

CMD ["node", "dist/src/main.js"]
