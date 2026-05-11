# ─── Stage 1: build ─────────────────────────────────────────────────
FROM node:20-slim AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@10.31.0 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ─── Stage 2: runtime ───────────────────────────────────────────────
FROM nginx:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
