# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AgriZone is a digital agriculture platform for Ghana (Phase 0 wedge: maize + tomato in
Ashanti + Bono East). This repo is the backend: a single **modular monolith** NestJS app
that serves a public web app, a field-agent PWA, and an internal admin console from one API.

**`BACKEND.md` is the authoritative operating manual.** It is ~950 lines specifying the
architecture, module list, conventions, anti-patterns, and the Phase 0 build sequence. Read
the relevant section before implementing anything — when a pattern is in question, return to
`BACKEND.md` rather than inventing a new one. The notes below summarize it and flag where the
current repo state diverges from it.

## Current state vs. the plan (important)

The repo is **pre-foundation**: `src/` still contains only the default NestJS starter
(`app.controller.ts`, `app.service.ts`, `app.module.ts`, `main.ts` returning "Hello World!").
None of the `BACKEND.md` architecture exists yet — no Prisma, Redis, BullMQ, modules,
`config/`, `common/`, or `integrations/`. Building those out is the work.

Be aware of these mismatches between `BACKEND.md` and the actual installed project:

| `BACKEND.md` says | Reality in this repo |
|---|---|
| NestJS `^10.3.0`, TypeScript `^5.4` | NestJS `^11.0.1`, TypeScript `^5.7.3` (already installed) |
| Repo layout under `apps/api/` (monorepo) | Flat layout — `src/` is at the repo root, not `apps/api/src/` |
| `docker-compose.yml`, `prisma/`, `.env.example`, `config/` | Do not exist yet |

When following `BACKEND.md`, keep its **patterns** but use the **actual installed versions**
and the **flat repo layout** (`src/...`, not `apps/api/src/...`) unless told to restructure.

## Commands

Package manager is **pnpm** (`pnpm-lock.yaml`).

```bash
pnpm install
pnpm run start:dev        # watch mode (primary dev loop)
pnpm run start            # run once
pnpm run start:prod       # node dist/main (after build)
pnpm run build            # nest build -> dist/
pnpm run lint             # eslint --fix over {src,apps,libs,test}
pnpm run format           # prettier --write

pnpm test                 # all unit tests (*.spec.ts under src/)
pnpm run test:watch
pnpm run test:cov         # coverage -> coverage/
pnpm run test:e2e         # e2e tests under test/ (*.e2e-spec.ts)

# Run a single unit test file or by name:
pnpm jest src/app.controller.spec.ts
pnpm jest -t "should return Hello"
```

Unit tests live next to source as `*.spec.ts` (jest `rootDir` is `src`). E2E tests live in
`test/` as `*.e2e-spec.ts` and use a separate config (`test/jest-e2e.json`).

## Architecture conventions (from BACKEND.md)

**Layering — enforced strictly.** Controllers call services; services call repositories and
other services (via DI); repositories call Prisma. **Never call Prisma from a controller or
service.** Each feature module follows the same layout: `*.module.ts`, `*.controller.ts`
(thin HTTP adapter), `*.service.ts` (business logic), `*.repository.ts` (Prisma only), plus
`dto/`, `events/`, optional `guards/`, and `__tests__/`.

**Three directory roles under `src/`:** `modules/` (feature modules), `common/` (cross-cutting
code used by *multiple* modules only — guards, interceptors, decorators, filters, pipes,
value objects), `integrations/` (thin wrappers around external services; no business logic),
`workers/` (BullMQ processors), `config/` (typed env validation).

**Non-negotiable rules:**
- **Money is `BigInt` in minor units (pesewas)** via a `Money` value object — never `Float`,
  never raw `BigInt` arithmetic for money. Serialize `BigInt` to string in response DTOs.
- **Soft delete only** — set `deletedAt`; queries filter `deletedAt: null` by default (Prisma
  extension). Never hard delete. Restore an existing soft-deleted record instead of recreating.
- **Audit everything mutating** — `AuditInterceptor` handles it automatically; call
  `AuditService.record(...)` for state changes needing explicit detail. Every financial event
  also lands in the append-only `Ledger`.
- **DTOs at every boundary** — validate input with `class-validator`; never accept raw Prisma
  shapes; never return Prisma models (serialize through a response DTO). Every endpoint
  validates; there are no "internal" HTTP endpoints that skip validation.
- **Errors** — throw NestJS HTTP exceptions (`NotFoundException`, etc.), never raw `Error`;
  don't catch-to-"handle gracefully" in services — let the global filter render the standard
  `{ error: { code, message, correlationId } }` shape. Error codes live in an enum; the
  frontend branches on `code`.
- **Cross-module access via exported services only** — no reaching into another module's
  internals. In-process domain events use `@nestjs/event-emitter` with typed payload classes
  in the emitting module's `events/` folder.
- **External calls** go through the `integrations/` pattern: timeout + bounded retry +
  circuit breaker (`opossum`). Async work goes to a BullMQ job (idempotent, bounded retry, DLQ).
- **Config is env-driven** via `ConfigService` with validation on startup — crash loudly on a
  missing required var. Never hard-code config. Never log PII (GhanaCard numbers, phones,
  tokens) or raw request bodies.
- **Schema changes are migrations** in source control — never `prisma db push`. IDs are CUIDs.
  Every domain table has `createdAt`, `updatedAt`, `deletedAt`. Add models in the migration
  that introduces their owning module; don't pre-create empty tables.

## Phase 0 scope (do not build ahead)

Phase 0 only. Several capabilities are explicitly **deferred** and must not be implemented
unless asked: in-platform payments (MoMo/cards), escrow (`EscrowModule` is **interface-only**,
methods throw `NotImplementedException`), Smile ID liveness, ComplyAdvantage, WhatsApp,
Stripe/subscriptions, formal disputes (replaced by a simple `SupportModule`). Notifications are
**SMS-only via Hubtel**. Advisor is **free** (no billing, no PDF — scenario summaries go out as
HTML email). Locales: **EN + TW only** (keep the full `Locale` enum). See `BACKEND.md` §1 and
the build sequence in §11. Build modules in the order given there; don't pre-add Phase 1+
modules, queues, env vars, or integrations.

## Lint/format notes

- ESLint uses `typescript-eslint` recommended-type-checked + Prettier. `no-explicit-any` is
  **off**, but `no-floating-promises` and `no-unsafe-argument` are `warn` — avoid both.
- Prettier: single quotes, trailing commas (`all`), `endOfLine: auto`.
