# コントロールプレーン(CP)のイメージ。ビルドコンテキストはリポジトリのルート:
#   docker build -f cp/Dockerfile -t okiba-cp .
#
# 同じイメージを 2 つの役割で使う:
#   - CP 本体: そのまま起動(Lambda Web Adapter が ALB からの HTTP を受ける)
#   - ワーカー: 環境変数 OKIBA_ROLE=worker と AWS_LWA_PASS_THROUGH_PATH=/api/internal/tick を付けて起動。
#     EventBridge の呼び出しが POST /api/internal/tick になり、1 回の tick を実行する。
#     ローカルでは `npm run worker -w cp`(ループ)か `npm run worker -w cp -- --once` を使う。

FROM public.ecr.aws/docker/library/node:24-slim AS deps
WORKDIR /src
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY cp/package.json cp/
COPY app/package.json app/
RUN npm ci --no-audit --no-fund

FROM public.ecr.aws/docker/library/node:24-slim AS builder
WORKDIR /src
COPY --from=deps /src/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY shared ./shared
COPY cp ./cp
ENV NEXT_TELEMETRY_DISABLED=1
RUN cd cp && npx next build

FROM public.ecr.aws/docker/library/node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV AWS_LWA_PORT=3000
ENV OKIBA_TEMPLATES_DIR=/app/templates
COPY --from=public.ecr.aws/awsguru/aws-lambda-adapter:0.9.1 /lambda-adapter /opt/extensions/lambda-adapter
COPY --from=builder /src/cp/.next/standalone ./
COPY --from=builder /src/cp/.next/static ./cp/.next/static
COPY templates ./templates
EXPOSE 3000
CMD ["node", "cp/server.js"]
