# ツールアプリのイメージ。ビルドコンテキストはリポジトリのルート:
#   docker build -f app/Dockerfile .
# Lambda(コンテナイメージ)+ Lambda Web Adapter で動かす。ECS Fargate でもそのまま動く。

FROM public.ecr.aws/docker/library/node:24-slim AS deps
WORKDIR /src
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY app/package.json app/
COPY cp/package.json cp/
RUN npm ci --workspace app --workspace shared --include-workspace-root=false --no-audit --no-fund

FROM public.ecr.aws/docker/library/node:24-slim AS builder
WORKDIR /src
COPY --from=deps /src/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY shared ./shared
COPY app ./app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w app

FROM public.ecr.aws/docker/library/node:24-slim AS runner
WORKDIR /srv
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3001 \
    AWS_LWA_PORT=3001 \
    AWS_LWA_READINESS_CHECK_PATH=/healthz
# outputFileTracingRoot がリポジトリのルートなので、standalone の中は app/server.js になる
COPY --from=builder /src/app/.next/standalone ./
COPY --from=builder /src/app/.next/static ./app/.next/static
COPY --from=builder /src/app/public ./app/public
EXPOSE 3001
CMD ["node", "app/server.js"]
