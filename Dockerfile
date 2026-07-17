# Volo Index — backend service container (T2-G / GIV-627)
# One deployable unit: T2-A HTTP API + static web assets.
# See docs/OPS-DEPLOYMENT-PLAN.md and docs/DEPLOY-RUNBOOK.md.

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim
ARG RELEASE_SHA=unknown
ENV NODE_ENV=production
ENV RELEASE_SHA=$RELEASE_SHA
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY web ./web
COPY content ./content
# GIV-701: GET / serves the original landing page (root index.html) and its
# /Assets favicons (see src/server/index.js). They must ship in the image.
COPY index.html ./
COPY Assets ./Assets

# Run as non-root
USER node

EXPOSE 3000

# /api/health returns 200 healthy (DB up) or 503 degraded (DB down).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server/index.js"]
