# Volo Index — Ops & Deployment Plan (T2-G / GIV-627)

**Date:** 2026-07-12 · **Author:** CTO · **Status:** T2-A (GIV-621) landed — deploy artifacts shipped (`Dockerfile`, `deploy/fly.{staging,production}.toml`, `deploy/docker-compose.staging.yml`, `docs/DEPLOY-RUNBOOK.md`); PaaS resolved to **Fly.io** (runbook §0). Domain confirmed `voloindex.org` + LinkedIn Page yes (CEO, GIV-641). Remaining gate: human account provisioning (runbook §1) → staging deploy → cutover (runbook §6).
**Scope source:** `docs/STOCK-TAKE-2026-07-12-launch-readiness.md` §4 (T2-G row) + board decision #3 (domain) and #4 (LinkedIn Company Page)

---

## 0. Design invariant (drives everything else)

**Credential URLs must be stable forever.** Certificates end up on LinkedIn profiles; a broken URL later is a broken promise to every holder. Therefore:

1. Credential URLs live on **our apex domain** (`https://<domain>/credential/{id}`), never on a hosting provider's subdomain (`*.fly.dev`, `*.onrender.com`, …).
2. The **domain is the permanent contract; the host is replaceable.** DNS fronts the host, so we can migrate providers without breaking a single credential link.
3. Certificate IDs are opaque, non-sequential (ULID/UUIDv7), so URLs can't be enumerated.

## 1. Topology (v1 — deliberately boring)

```
Cloudflare (DNS + TLS edge + WAF + rate limiting + CDN)
        │
        ▼
Managed PaaS: single Node app  ← T2-A HTTP API + serves T2-B web app statics
        │
        ▼
Managed Postgres (T2-A schema: users, sessions, transcripts, scores, certificates)
        │
        ▼ (outbound only)
Anthropic API (Sonnet 4.6 interviewer/extractor)
```

- **One deployable unit** at launch. No microservices, no Kubernetes. The AE is a library; T2-A wraps it in one HTTP service. Scale-out is horizontal replicas if ever needed — sessions are DB-persisted (resume-after-disconnect requirement in T2-A/B already forces this), so the app tier stays stateless.
- **Hosting recommendation:** Fly.io or Render (either is fine; both do git-driven deploys, secret stores, health checks, managed Postgres or first-class integration with Neon). Decision criterion is ops simplicity, not performance — assessment traffic is low-QPS/long-session. Final pick at execution time with Engineer (T2-A) based on their SSE/streaming ergonomics (chat streaming is the one hard runtime requirement).
- **Environments:** `staging` (host subdomain is fine here) + `production` (apex). Staging uses a separate Anthropic key with a low spend cap.

## 2. Domain & DNS

- **Permanent domain CONFIRMED: `voloindex.org`** (CEO decision, GIV-641) — registered to Give Protocol Foundation (the org, not an individual; auto-renew on; registrar lock on; org WHOIS contact). Optional non-gating: defensively register `voloindex.com` and 301 it to `.org`.
- DNS at **Cloudflare** (free tier suffices): apex + `www` → app; proxied (orange-cloud) for TLS, WAF, and rate limiting at the edge.
- Reserved paths from day one: `/credential/{id}` (public credential pages), `/api/*` (backend), `/verify/{id}` (verification endpoint, T2-D).
- **LinkedIn Company Page: CONFIRMED YES** (GIV-641) — needed only for the logo on profile entries; not launch-blocking. Until it exists, sharing uses the `organizationName` fallback (no code change).

## 3. TLS

- Edge TLS via Cloudflare (automatic, always-on, HSTS enabled after burn-in).
- Origin: platform-managed certs (Fly/Render issue Let's Encrypt automatically); Cloudflare "Full (strict)" mode.
- No certificates to manage by hand anywhere. HTTP → HTTPS redirect at edge.

## 4. Secrets management (Anthropic key et al.)

| Rule | Detail |
|---|---|
| **Never in git** | CI check already implicit; key names documented, values never. `.env` files git-ignored; production values only in the platform secret store. |
| **Server-side only** | The Anthropic key exists exclusively in the backend runtime. The browser never talks to Anthropic; all LLM calls go through T2-A. |
| **Dedicated workspace key** | Create a dedicated Anthropic workspace for Volo Index prod with **hard monthly spend cap** at console level (belt) on top of the engine's per-session `$0.50`/`$2.00` caps (suspenders). Separate key + tiny cap for staging. |
| **Rotation** | Quarterly, and immediately on any suspected exposure. Rotation is a secret-store update + redeploy — zero code change. |
| **Other secrets** | DB URL (platform-injected), magic-link email provider key (T2-C), Sentry DSN. Same rules. |

## 5. Monitoring & alerting

- **Uptime:** external probe (UptimeRobot/Better Stack free tier) on `/healthz` + one synthetic hit on a credential page (the URL class we promised is forever).
- **Errors:** Sentry (Node SDK) in the backend; release-tagged from CI.
- **Logs:** structured JSON to platform log drain; no transcript content in logs (consent posture — transcripts only in the consent-gated store, per D4).
- **Cost telemetry:** per-session token spend is already emitted by the engine cost-cap layer; aggregate it to a daily metric + alert at 70% of the monthly Anthropic cap.
- **Alert routing:** ops alerts → CTO; cost-cap alerts → CTO + CEO.
- **Publication-queue watch:** alert if `pending_review` queue depth > N for > 48h (first-50 QA hold, D5) so certificates don't silently stall.

## 6. Abuse controls

Layered, mostly already designed:

1. **Edge (Cloudflare):** IP rate limits on `/api/*`, bot-fight mode, geo/ASN blocks if abused.
2. **Auth gate (T2-C):** assessment start requires a verified magic-link account — email verification is the v1 CAPTCHA.
3. **Entitlement:** per-account concurrent-session limit (1) and lifetime/daily assessment quota until pricing decided (board decision #1).
4. **Engine (shipped):** per-session cost caps, max-turns bound, anti-hallucination verbatim-span gate (the load-bearing prompt-injection defence — scores can only cite spans the candidate actually wrote).
5. **Workspace spend cap (Anthropic console):** the final backstop; worst-case blast radius of any abuse = monthly cap.

## 7. CI/CD

- Existing GitHub Actions (`GiveProtocolFoundation/VoloIndex`) extends to: test (309/309 suites) → deploy staging on merge to `main` → manual promote to production. Deploys gated on green tests; no direct-to-prod pushes.

## 8. Execution order & dependencies

| Step | Depends on | Can start now? |
|---|---|---|
| Register `voloindex.org` + Cloudflare DNS | ✅ Decision done (GIV-641) | Yes — registration + purchase (human, runbook §1 #1–2) |
| LinkedIn Company Page | ✅ Decision done (GIV-641: yes) | Yes (human, runbook §1 #3) |
| Anthropic prod/staging workspaces + caps | Nothing | Yes (account admin) |
| Provision PaaS + Postgres + secret store | T2-A (GIV-621) service skeleton exists | ✅ T2-A done — artifacts shipped; account creation is a human action (runbook §1) |
| Staging deploy + monitoring + Sentry wiring | T2-A deployable | Ready — runbook §§2–5 |
| Edge rate limits + WAF tuning | Staging live | After staging deploy |
| Production cutover on apex | Domain registered + staging green | Domain decision ✅ (GIV-641) — cutover per runbook §6 once staging green |

**Bottom line (updated 2026-07-12, post-GIV-641):** All decisions are resolved — Fly.io (runbook §0), `voloindex.org` (GIV-641), LinkedIn Company Page yes (GIV-641) — and all deployment artifacts exist in-repo; the deploy path is fully scripted in `docs/DEPLOY-RUNBOOK.md`. The ONLY remaining work is human account provisioning per runbook §1 (registrar, Cloudflare, Anthropic workspaces + caps, Fly apps, Neon Postgres, Sentry/uptime, LinkedIn Page) followed by staging deploy → §6 cutover. No code or config gaps remain on the agent side.
