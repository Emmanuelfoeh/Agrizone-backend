# AgriZone Backend Phase 0 — Implementation Plan Series (Overview)

> **For agentic workers:** This is the index for a series of plans. Each step below is its
> own plan file under `docs/superpowers/plans/`. Implement them **in order** — each is gated
> by green CI before the next starts. Use `superpowers:subagent-driven-development` (recommended)
> or `superpowers:executing-plans` per plan file. Steps within each plan use checkbox (`- [ ]`)
> syntax for tracking.

**Goal:** Build the AgriZone Phase 0 backend — a modular-monolith NestJS API that serves the
existing Next.js UI prototype, replacing its Zustand stand-in stores with a real API whose
shapes match the UI's `types.ts` contract.

**Design source:** `docs/superpowers/specs/2026-06-01-agrizone-backend-phase0-design.md`.
Read it before any plan. Where this series and the spec disagree, the spec wins (open an edit).

**Architecture:** Single deployable NestJS 11 app under flat `src/`. Strict layering
controller → service → repository → Prisma. Postgres 16 + Prisma 6, Redis 7 + BullMQ 5,
Pino, Sentry, Swagger `/v1/docs`. Money is `BigInt` pesewas; soft-delete everywhere; CUID ids;
every mutation audited. Phase 0 defers escrow/payments (interface-only) and in-platform money.

**Tech stack:** NestJS 11, TypeScript 5.7, Prisma 6, Postgres 16, Redis 7, BullMQ 5,
`@nestjs/jwt`/`passport-jwt`, `class-validator`/`class-transformer`, `nestjs-pino`,
`@nestjs/terminus`, `@nestjs/swagger`, `@sentry/node`, `opossum`, Jest + supertest. pnpm.

---

## Conventions every plan in this series follows

- **TDD.** Each behavioural task: write the failing test → run it red → minimal impl → run
  it green → commit. Unit tests are `*.spec.ts` next to source (`jest`, Prisma mocked);
  module-integration tests live in `__tests__/`; e2e in `test/` (`*.e2e-spec.ts`, supertest).
- **Layering.** Controller (thin) → service (logic) → repository (Prisma only). Never call
  Prisma outside a repository.
- **DTOs.** Validate input with `class-validator`; never return Prisma models — serialize via
  a response DTO. `BigInt` → string in responses.
- **Errors.** Throw NestJS HTTP exceptions; codes from `common/errors/error-codes.ts`; the
  global filter renders `{error:{code,message,correlationId}}`.
- **Commits.** Frequent, one per task minimum. Conventional-commit messages
  (`feat:`/`test:`/`chore:`). Co-author trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Local ports.** The UI dev server owns `:3000`; **the API runs on `:3001`** locally
  (`PORT=3001`), and the UI's `NEXT_PUBLIC_API_URL` points at `http://localhost:3001/v1`.

---

## Plan files & status

| Step | Plan file | Spec §8 modules | Status |
|---|---|---|---|
| 1 | `2026-06-01-step-1-foundation.md` | Config, Common/Prisma, Health, logging, Sentry, Swagger, CI | **Written** |
| 2 | `2026-06-01-step-2-identity.md` | Users, Auth (OTP/JWT), Audit, guards/decorators | Pending |
| 3 | `2026-06-01-step-3-kyc-verification.md` | Kyc (NIA), Verification, VerificationEvent | Pending |
| 4 | `2026-06-01-step-4-marketplace-core.md` | Listings, Files, Search, Inquiries, Messaging | Pending |
| 5 | `2026-06-01-step-5-transactions-ledger.md` | Transactions, Ledger, Commissions, Escrow/Payments (iface), Activity | Pending |
| 6 | `2026-06-01-step-6-trust-ops.md` | Moderation, Support, Ratings, Reputation | Pending |
| 7 | `2026-06-01-step-7-knowledge-notifications.md` | Content, QA, Notifications (SMS), Webhooks | Pending |
| 8 | `2026-06-01-step-8-advisor.md` | Intelligence, Scenarios, Agents | Pending |
| 9 | `2026-06-01-step-9-hardening.md` | perf/indices/N+1, k6, pentest prep, docs | Pending |

Each pending plan is written to full bite-sized fidelity just before its step begins (or on
request), so its task code matches the types/patterns actually established by earlier steps —
avoiding speculative detail that drifts. The task-level breakdown for every module already
exists in spec §8; the per-step plan expands those into test-first steps.

---

## Dependency graph (what unblocks what)

```
Step 1 Foundation
  └─> Step 2 Identity (needs Prisma, config, guards scaffold, audit interceptor)
        ├─> Step 3 KYC & Verification (needs User + tier + events)
        └─> Step 4 Marketplace core (needs auth, tiers, files)
              └─> Step 5 Transactions/Ledger/Commission (needs inquiries.accept seam)
                    ├─> Step 6 Trust ops (needs transactions for ratings)
                    └─> Step 7 Knowledge & Notifications (needs auth; notifications used earlier via queue)
                          └─> Step 8 Advisor (needs intelligence ingestion)
                                └─> Step 9 Hardening (needs everything)
```

Note: NotificationsModule's `notifications` queue + `HubtelService` are stood up minimally in
Step 2 (OTP SMS needs them); Step 7 completes the module (templates, prefs, webhooks).

---

## UI contract acceptance (the through-line)

Every step lists the UI hooks it unblocks (spec §4.1). The series is "done for Phase 0" when
each hook in `agrizone/src/hooks/use-marketplace.ts` and `useCurrentUser()` is backed by a
real endpoint returning the `agrizone/src/lib/types.ts` shapes, verified by the four e2e
critical paths (spec §10) run against a backend seeded to mirror `agrizone/src/stores/marketplace.ts`.
