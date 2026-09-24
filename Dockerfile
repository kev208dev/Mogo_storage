# syntax=docker/dockerfile:1
# 모의고사 창고 production image (Next.js Node runtime + 운영 CLI).
#   docker build -t mogo-storage .
#   docker run --env-file .env.production -p 3000:3000 mogo-storage
#   docker run --env-file .env.production mogo-storage npm run db:migrate:prod
# 주의: 실제 시험 PDF/음원은 이미지에 포함되지 않는다 (스토리지 R2 또는 공식 URL redirect).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 빌드 시점에는 DB 없이 샘플 데이터로 정적 페이지를 만들지 않도록 DATABASE_URL 을 build arg 로 받을 수 있다.
# (없으면 런타임 ISR 로 채워진다)
ARG NEXT_PUBLIC_SITE_URL=https://example.invalid
ENV NEXT_PUBLIC_SITE_URL=${NEXT_PUBLIC_SITE_URL}
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000
# 운영 CLI(ingest:*, db:migrate:prod)는 tsx 로 소스를 실행하므로 node_modules 와 src 를 함께 둔다
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build --chown=node:node /app/next.config.ts /app/tsconfig.json ./
COPY --from=build --chown=node:node /app/src ./src
COPY --from=build --chown=node:node /app/scripts ./scripts
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/data ./data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "next", "start", "-H", "0.0.0.0"]
