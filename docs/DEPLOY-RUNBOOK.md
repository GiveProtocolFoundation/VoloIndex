# Volo Index — Deploy Runbook (T2-G / GIV-627)

**Companion to** `docs/OPS-DEPLOYMENT-PLAN.md` (the *why*); this is the *how*.
**Artifacts:** `Dockerfile`, `.dockerignore`, `deploy/fly.staging.toml`, `deploy/fly.production.toml`, `deploy/docker-compose.staging.yml`.

## 0. PaaS decision (resolved)

**Fly.io.** Plan §1 left the pick to execution time based on SSE/streaming ergonomics. Fly's proxy does not buffer or idle-kill long-lived streaming responses, which is the one hard runtime requirement (chat interview streaming). Managed Postgres via Fly Postgres or Neon — either satisfies the plan; prefer **Neon** (true managed service, point-in-time restore, no cluster to babysit).

## 1. One-time provisioning (human/board actions — cannot run from CI)

| # | Action | Owner | Gate |
|---|--------|-------|------|
| 1 | Register apex domain **`voloindex.org`** — **CONFIRMED by CEO (GIV-641)**: GPF registrar account (org-owned, not personal), auto-renew ON, registrar lock ON, org WHOIS contact. Optional non-gating: defensively register `voloindex.com`, 301 → `.org` | Board/CEO | Decision done; registration pending |
| 2 | Cloudflare account + zone, apex & `www` proxied | CTO after #1 | #1 |
| 3 | LinkedIn Company Page — **CONFIRMED YES (GIV-641)**; until it exists, sharing uses `organizationName` fallback (no code change) | Board/CEO | Not launch-blocking |
| 4 | Anthropic prod workspace + hard monthly cap; separate staging workspace + tiny cap | CTO | none |
| 5 | Fly.io org account; `voloindex-staging` + `voloindex-prod` apps | CTO/Engineer | none |
| 6 | Neon (or Fly) Postgres: staging + prod databases | CTO/Engineer | #5 |
| 7 | Sentry project + DSN; UptimeRobot/Better Stack probe on `/api/health` + one credential URL | CTO/Engineer | staging live |

## 2. Secrets (plan §4 — never in git)

```
fly secrets set -a voloindex-staging ANTHROPIC_API_KEY=<staging-key> DATABASE_URL=<staging-pg-url> \
  JWT_SECRET=<staging-jwt-secret> INTERNAL_API_KEY=<staging-internal-key> \
  AUTH_BASE_URL=https://voloindex-staging.fly.dev
fly secrets set -a voloindex-prod    ANTHROPIC_API_KEY=<prod-key>    DATABASE_URL=<prod-pg-url> \
  JWT_SECRET=<prod-jwt-secret> INTERNAL_API_KEY=<prod-internal-key> \
  AUTH_BASE_URL=https://voloindex.org
```

Generate `JWT_SECRET` / `INTERNAL_API_KEY` with `openssl rand -hex 32`; never share across environments.
`AUTH_BASE_URL` MUST be set (T2-C, GIV-623) — unset falls back to the request Host header (host-header
injection into magic-link emails). `EMAIL_PROVIDER` (+ provider key) required in prod once transactional
email is provisioned; until then magic links log to console only.

Rotation = re-run `fly secrets set` + automatic redeploy. Quarterly, or immediately on suspected exposure.
Note: rotating `JWT_SECRET` invalidates all live sessions (24h JWTs) — acceptable; users re-request a link.

## 3. Migrations

Run before first traffic and after any schema change:

```
fly ssh console -a voloindex-staging -C "node src/server/migrate.js"
```

(Locally: `npm run migrate` with `DATABASE_URL` set.)

## 4. Deploy

```
# Staging (auto on merge to main once CI wired — plan §7)
fly deploy -c deploy/fly.staging.toml

# Production (manual promote only, after staging green)
fly deploy -c deploy/fly.production.toml
```

Health gate: Fly checks `/api/health` — 200 `healthy` requires a live DB (`SELECT 1`); 503 `degraded` fails the check and blocks rollout. Rollback: `fly releases -a voloindex-prod` → `fly deploy --image <previous>`.

## 5. Local staging-parity smoke

```
ANTHROPIC_API_KEY=<staging-key> docker compose -f deploy/docker-compose.staging.yml up --build
docker compose -f deploy/docker-compose.staging.yml run --rm app node src/server/migrate.js
curl -s http://localhost:3000/api/health   # {"status":"healthy",...}
```

## 6. Production cutover (domain confirmed: `voloindex.org` — GIV-641)

1. Staging green ≥ 48h (checks + Sentry quiet).
2. Cloudflare: `voloindex.org` + `www` → `voloindex-prod.fly.dev` via CNAME (proxied); Full (strict) TLS; HTTP→HTTPS redirect; HSTS after burn-in.
3. `fly certs add voloindex.org -a voloindex-prod` (origin cert for Full-strict).
4. Set `CORS_ORIGINS="https://voloindex.org,https://www.voloindex.org"` in `deploy/fly.production.toml`, deploy.
5. Edge rate limits on `/api/*` (plan §6); verify credential page synthetic probe.

## 7. Verify after any deploy

- `GET /api/health` → 200, `rubricVersion: "1.2"`, `assessmentEngineEnabled: true`, `db: "connected"`.
- One full mock chat turn against staging (SSE stream stays open).
- Sentry receives a release-tagged event (deliberate test error or release marker).
