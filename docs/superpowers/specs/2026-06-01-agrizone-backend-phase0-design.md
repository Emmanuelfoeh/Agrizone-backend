# AgriZone Backend — Phase 0 Design Spec

**Date:** 2026-06-01
**Status:** Approved design → ready for implementation planning
**Authoritative inputs:** `BACKEND.md` (backend operating manual), `../agrizone` UI repo
(`FRONTEND.md` + the working Next.js prototype whose Zustand stores are an explicit
stand-in for this backend).
**Scope:** Phase 0 only (maize + tomato; Ashanti + Bono East). Do not build Phase 1+.

This spec is the contract between the UI that already exists and the backend that doesn't
yet. It exists because the frontend prototype has already pinned the data shapes and the
mutation set the API must serve; this document makes that contract explicit, reconciles it
with `BACKEND.md`'s revised Phase 0 scope, and specifies every module to be built.

---

## Table of contents

1. [Decisions of record](#1-decisions-of-record)
2. [Architecture & foundations](#2-architecture--foundations)
3. [Cross-cutting concerns](#3-cross-cutting-concerns)
4. [The UI-derived API contract](#4-the-ui-derived-api-contract)
5. [Phase 0 money-flow reconciliation](#5-phase-0-money-flow-reconciliation)
6. [Verification tier ladder](#6-verification-tier-ladder)
7. [Data model (Prisma, Phase 0)](#7-data-model-prisma-phase-0)
8. [Module specifications](#8-module-specifications)
9. [Build sequence](#9-build-sequence)
10. [Testing & CI](#10-testing--ci)
11. [Environment variables](#11-environment-variables)
12. [Risks & open questions](#12-risks--open-questions)

---

## 1. Decisions of record

These were resolved with the product owner on 2026-06-01 and bind the rest of the spec.

| # | Decision | Choice | Consequence |
|---|---|---|---|
| D1 | Phase 0 money flows | **BACKEND.md revised scope** | No escrow/MoMo. Settlement off-platform, recorded post-hoc. Commission invoiced monthly. Wallet = read-model over the ledger. See §5. |
| D2 | Repo layout | **Flat `src/` at root** | Build under `src/modules`, `src/common`, `src/integrations`, `src/workers`, `src/config`. BACKEND.md's `apps/api/...` paths map to `src/...`. |
| D3 | Framework versions | **Current majors** | NestJS 11, TypeScript 5.7 (already installed), Prisma 6, BullMQ 5, `@nestjs/*` 11. BACKEND.md's "NestJS 10 / TS 5.4" pinning is treated as out of date. |
| D4 | Plan depth | **Full detail, all modules** | Every Phase 0 module specified here (models, endpoints, events, jobs, the UI hook it unblocks). |
| D5 | Verification tiers | **UI 5-tier ladder** | T0 Account / T1 Phone / T2 GhanaCard / T3 Agent-visit / T4 Produce-inspected. Refines BACKEND.md §7.6 (which folded phone+GhanaCard into T1). See §6. |

**The governing principle:** the UI's `src/lib/types.ts` and its hooks
(`src/hooks/use-marketplace.ts`) are the acceptance test. Every endpoint must be able to
hydrate an existing hook so that, per the UI repo's own `CLAUDE.md`, *"when the backend
lands, swap the hook internals for TanStack Query + the API; screens shouldn't change."*

---

## 2. Architecture & foundations

A single deployable **modular monolith** NestJS app. Module boundaries enforced by lint;
no microservices. Layering is strict and non-negotiable:

```
controller  ->  service  ->  repository  ->  Prisma
(HTTP only)     (logic)      (data only)      (DB)
```

Controllers never touch Prisma. Services never touch Prisma. Repositories never contain
business logic. Cross-module access is via exported services only — never by importing
another module's repository or reaching into its internals.

### Directory layout (flat, per D2)

```
src/
├── main.ts                      # bootstrap + global setup
├── app.module.ts                # root module wiring
├── config/                      # ConfigModule, env schema + validation
├── common/                      # shared across >1 module ONLY
│   ├── decorators/              # @CurrentUser, @RequireRole, @RequireTier
│   ├── guards/                  # JwtAuthGuard, RolesGuard, TierGuard
│   ├── interceptors/            # AuditInterceptor, LoggingInterceptor
│   ├── filters/                 # AllExceptionsFilter
│   ├── pipes/                   # global ValidationPipe config
│   ├── middleware/              # correlation-id
│   ├── value-objects/           # Money
│   ├── errors/                  # error-codes.ts
│   ├── services/                # PrismaService (with soft-delete extension)
│   └── types/                   # AuthenticatedUser, etc.
├── modules/                     # feature modules (see §8)
├── integrations/                # thin external-service wrappers (§3.7)
└── workers/                     # BullMQ processors + queue-names.ts
prisma/
├── schema.prisma
└── migrations/
docker-compose.yml               # postgres 16 + redis 7
.env.example
```

### Runtime stack

- **NestJS 11** (Express platform), TypeScript 5.7, Node 20 LTS, pnpm.
- **Postgres 16** via **Prisma 6** (`@prisma/client`).
- **Redis 7** for OTP/refresh-token storage, caching, and **BullMQ 5** queues.
- **Pino** (`nestjs-pino`) structured logging; **Sentry** errors; **Swagger** at `/v1/docs`.
- API is versioned under `/v1`. Health at `/v1/health` (`@nestjs/terminus`).

---

## 3. Cross-cutting concerns

Specified once; every module reuses these rather than reinventing.

### 3.1 Authn — phone OTP + JWT

1. `POST /v1/auth/request-otp` → 6-digit code, hash stored in Redis (5-min TTL), SMS sent
   via the notifications queue (Hubtel).
2. `POST /v1/auth/verify-otp` → on match, issue access JWT (15 min) + refresh token
   (30 days, stored/rotated in Redis). First successful verify promotes T0 → **T1**.
3. `POST /v1/auth/refresh` → rotate refresh token, issue new access token.
4. `GET /v1/me` → current user profile (hydrates the UI `useCurrentUser()`).

Tokens are delivered in **HttpOnly cookies** (the UI never reads the token; FRONTEND.md §6.8).
`JwtAuthGuard` extends Passport `AuthGuard('jwt')`.

### 3.2 Authz — roles & tiers

- `@RequireRole(...roles)` + `RolesGuard` (reads `roles` metadata via `Reflector`).
- `@RequireTier(tier)` + `TierGuard` — **ordinal** comparison T0 < T1 < T2 < T3 < T4.
- `@CurrentUser()` injects the `AuthenticatedUser` resolved by the JWT strategy.

### 3.3 Audit — automatic + explicit

`AuditInterceptor` writes an `AuditLog` row for every mutating request (actor, IP,
user-agent, endpoint, correlation id, before/after where feasible), asynchronously so it
never blocks the response. State changes needing explicit detail (tier change, commission
rate edit, moderation action) call `AuditService.record(...)` directly.

### 3.4 Money

All money is `BigInt` minor units (**pesewas**; GHS × 100). A `Money` value object in
`common/value-objects/money.ts` owns all arithmetic and formatting. Never `Float`, never
raw `BigInt` math for money. Response DTOs serialize `BigInt` → **string**.

> Contract note: the UI keeps `price` as a `number` in **major** GHS units (e.g. `350`).
> The API is canonical (minor-unit strings); the UI's hook adapter divides by 100 at the
> boundary. The `types.ts` shape is unchanged.

### 3.5 Errors

Services throw NestJS HTTP exceptions (`NotFoundException`, `ConflictException`, …), never
raw `Error`. `AllExceptionsFilter` renders the consistent envelope the UI branches on:

```json
{ "error": { "code": "LISTING_NOT_FOUND", "message": "Listing not found", "correlationId": "01HX…" } }
```

Codes live in `common/errors/error-codes.ts` as an enum. The UI matches on `code`
(FRONTEND.md §6.9 — e.g. `TIER_TOO_LOW` triggers a verification prompt), never on `message`.

### 3.6 Domain events

In-process via `@nestjs/event-emitter`, **typed payloads only** (payload class in the
emitting module's `events/`). Examples: `listing.created`, `inquiry.accepted`,
`transaction.completed`, `verification.tier-changed`. Subscribers in other modules react
(moderation queues an image check; notifications send an SMS; the activity feed appends).

### 3.7 Integrations

Each external service lives in `integrations/<name>/` and exposes a typed interface; modules
consume the interface, not the implementation. Every call has a **timeout + bounded retry +
`opossum` circuit breaker**. Phase 0 wired integrations:

| Integration | Consumer | Mode |
|---|---|---|
| Hubtel SMS | Notifications, Auth (OTP) | Worker-driven outbound; delivery webhook inbound. **SMS only** — no MoMo. |
| NIA GhanaCard | KYC | Synchronous + worker retry on transient failure |
| Open-Meteo | Intelligence | Cached; daily refresh |
| NASA POWER | Intelligence | Cached; quarterly refresh |
| MOFA SRID / Esoko | Intelligence | Batch import worker |
| Mapbox geocoding | Listings | Synchronous |
| Sentry | All | Direct SDK |
| S3-compatible storage | Files | Signed URLs only |

### 3.8 Background jobs (BullMQ)

Queue names are constants in `workers/queue-names.ts`. Phase 0 set:
`notifications`, `image-processing`, `reconciliation` (commission-invoice),
`weather-refresh`, `reference-price`, `reputation-recompute`. Every job is **idempotent**,
**bounded-retry** (3 attempts, exponential backoff), routes to a **DLQ** on final failure,
and logs start/end/duration with failures to Sentry.

### 3.9 Soft delete

Every domain table has `createdAt`, `updatedAt`, `deletedAt?`. A Prisma client extension in
`PrismaService` filters `deletedAt: null` by default; repositories opt out explicitly to see
deleted rows. Never hard-delete; never soft-delete-then-recreate (restore instead).
**Exception:** `LedgerEntry` and `AuditLog` are append-only — no `deletedAt`, no updates.

### 3.10 Config

`ConfigModule` validates env on startup (Zod or class-validator). Missing required var =
crash loudly, not silent `undefined`. Nothing is hard-coded; no `"GH"`/`"ghana"` literals
outside config (the platform is built to scale across Africa).

---

## 4. The UI-derived API contract

The single most important section: what the API must expose, derived from the UI's hooks,
actions, and domain types. Each endpoint is justified by the hook it unblocks.

### 4.1 Hook → endpoint map

| UI hook / action (`use-marketplace.ts`) | HTTP | Module |
|---|---|---|
| `useCurrentUser()` *(FRONTEND.md)* | `GET /v1/me` | Auth/Users |
| `useFeed()` — active listings, all sellers | `GET /v1/listings?status=active&crop=&region=` | Listings + Search |
| `useMyListings()` — signed-in farmer's, excl. sold | `GET /v1/listings?seller=me` | Listings |
| `useListing(id)` | `GET /v1/listings/:id` | Listings |
| `postListing(NewListing)` | `POST /v1/listings` | Listings (+ Files) |
| `useFarmerInbox()` — inquiries on my lots | `GET /v1/inquiries?role=seller` | Inquiries |
| `useBuyerInbox()` — my inquiries | `GET /v1/inquiries?role=buyer` | Inquiries |
| `useInquiriesFor(lotId)` | `GET /v1/listings/:id/inquiries` | Inquiries |
| `useInquiry(id)` | `GET /v1/inquiries/:id` | Inquiries |
| `sendInquiry({lotId,buyerId,qtyBags,price,pickupAt,text})` | `POST /v1/inquiries` | Inquiries |
| `addMessage({qId,by,text\|voice})` | `POST /v1/inquiries/:id/messages` | Messaging |
| `counter({qId,by,price})` | `POST /v1/inquiries/:id/counter` | Inquiries |
| `accept({qId,by})` | `POST /v1/inquiries/:id/accept` | Inquiries → Transactions |
| `decline({qId,by})` | `POST /v1/inquiries/:id/decline` | Inquiries |
| `schedulePickup({qId,pickupAt})` | `POST /v1/transactions/:id/pickup` | Transactions |
| `releasePayment({qId})` | `POST /v1/transactions/:id/complete` | Transactions + Ledger + Commissions |
| `useWalletBalance(personId)` | `GET /v1/wallet/me` | Ledger (read-model) |
| `useActivity()` | `GET /v1/activity` | Activity (event-derived) |
| Advisor scenarios list | `GET /v1/advisor/scenarios` | Scenarios |
| Advisor scenario detail + recompute | `GET /v1/advisor/scenarios/:id`, `POST /v1/advisor/scenarios/:id/recompute` | Scenarios + Intelligence |

### 4.2 Response DTO ↔ UI type alignment

The UI types are the boundary. The API returns canonical shapes; the hook adapter maps
fields. Key alignments (UI type ← API source):

**`Listing`** (`types.ts`):
- `code` ← `lotId` (`AZ-25-MZ-A04829`)
- `title` ← `crop` + `variety` (e.g. `"Maize · white, dried"`), composed in the DTO
- `bags`/`crates` ← `quantityUnits` keyed by `unitLocal`
- `unit` ← `unitLocal` (`bag` | `crate`)
- `kg` ← `quantityKg`
- `price` ← `priceMinor / 100` (per local unit)
- `tier` ← seller's `verificationTier` (denormalized at read)
- `region` ← region name resolved from `regionCode`
- `distance` ← computed from buyer geo vs listing geo (Phase 0: region-centroid approximation)
- `priceStatus` ← computed server-side vs the **reference price band** (replaces the UI's
  local `priceStatusFor` heuristic; Intelligence provides the band)
- `postedAt` ← relative format of `createdAt`
- `status` ← mapped: `ACTIVE→active`, `HELD→reserved`, `SOLD→sold`; `pickup` is derived when
  a linked transaction is in a pickup state (see §5)
- `moisture` ← `qualityAttrs.moisture`

**`Inquiry`** (`types.ts`):
- `lotId` ← `listingId`, `buyerId` ← buyer, `qtyBags` ← `quantityUnits`,
  `price` ← `offerPriceMinor / 100`, `pickupAt` ← linked transaction's `pickupAt`
- `history: Message[]` ← the inquiry's `MessageThread` messages
- `status` ← **composed**: inquiry status (`sent`/`countered`/`accepted`/`declined`) OR, once
  accepted, the linked transaction's state surfaced as `pickup`/`paid`. The adapter merges
  inquiry + transaction into the single UI enum.

**`Message`** (`types.ts`): `{by, type(msg|voice|offer|counter|accept), text?, dur?, price?, qty?, at}`
← `Message` rows (`senderId`, `type`, `text`, `durationSec`, `priceMinor/100`,
`quantityUnits`, relative `createdAt`).

**`ActivityItem`**: `{at, who, text, persona}` ← event-derived feed (§8 Activity).

**Advisor `Scenario` + `CostBuildup`** (`advisor.ts`): the cost build-up is deterministic
from inputs `{capital, procurementWeeks, bags, holdingWeeks}` — the backend reproduces the
exact `COST_LINES` model so defaults match the design and edits recompute identically. The
headline ROI band (`low/high/mode`), `prob`, and `conf` come from the Monte Carlo engine over
Intelligence data (the UI currently hardcodes them).

---

## 5. Phase 0 money-flow reconciliation

Per **D1**, the UI prototype's richer money flow is rendered with Phase 0's deferred
implementations. The prototype's labels stay; the mechanics change.

| Prototype behaviour (`marketplace.ts`) | Phase 0 backend behaviour |
|---|---|
| `accept()` sets status `accepted`, listing `reserved`, activity *"escrow funded"* | Inquiry → `ACCEPTED`; a `Transaction(CONFIRMED)` is created; listing → `HELD`. **`EscrowModule` is interface-only** (`hold/release/freeze/refund` throw `NotImplementedException('Escrow is Phase 2')`). The *"escrow funded"* string is a display label only. |
| `schedulePickup()` sets status `pickup` | `Transaction` → `PICKUP_SCHEDULED` (with `pickupAt`). UI surfaces inquiry status `pickup` from the transaction state. |
| Pickup confirmed via 4-digit code (`/pickup/[id]`) | `Transaction` carries a `pickupConfirmationCode`; confirming advances `PICKUP_DONE`. |
| `releasePayment()` credits wallet `gross × 0.985`, listing `sold`, activity *"Payment released → MoMo"* | `complete` records the **off-platform** settlement: `Transaction` → `COMPLETED`, listing → `SOLD`, a `LedgerEntry(SETTLEMENT_RECORDED)` is appended, and **commission accrues** (1.5% default) to a `CommissionInvoice` for the buyer/aggregator account. **No Hubtel MoMo call.** `PaymentsModule` is interface-only. |
| `useWalletBalance()` shows a running balance | `GET /v1/wallet/me` returns a **read-model**: sum of the account's `LedgerEntry` rows (recorded settlements, net of accrued commission). Informational, not an in-platform custodial balance. |

**Implication to surface in the UI handoff:** in Phase 0 the seller-side "net after 1.5%"
and the wallet are informational read-models over recorded (off-platform) settlements, not a
held balance. The hook can still display them unchanged.

---

## 6. Verification tier ladder

Aligned to the UI's rendered ladder (`src/components/brand/verification.tsx`), refining
BACKEND.md §7.6 (per **D5**):

| Tier | UI label | Earned by | Backend method |
|---|---|---|---|
| T0 | Unverified — "Account exists" | account created | — |
| T1 | Phone | phone OTP verified | `AuthModule` verify-otp |
| T2 | ID Verified — "GhanaCard matched" | NIA GhanaCard match | `KycModule` |
| T3 | Agent Visited | field agent confirms identity & farm | `AgentsModule` visit |
| T4 | Field-Verified | produce inspected | `AgentsModule` inspection |

`VerificationModule` owns the state machine; each transition writes a `VerificationEvent`
and emits `verification.tier-changed` (audited). Tier gates (configurable):
- Create listing: `≥ T1`.
- Higher-trust surfacing/badging: `≥ T2`.

---

## 7. Data model (Prisma, Phase 0)

Conventions: CUID ids; `createdAt`/`updatedAt`/`deletedAt?` on domain tables; `BigInt` minor
units for money; Prisma `enum` types; explicit `@relation`. **Add each model in the migration
that introduces its owning module — do not pre-create empty tables.** Phase 2 models
(`EscrowHold`, `Payment`, `DisputeCase`) are NOT created in Phase 0.

Models by owning module (full field lists are specified per-module in §8):

| Model | Owner (module / §8) | Notes |
|---|---|---|
| `User`, `UserRole` | Users | `displayName` (public) + `encryptedFullName`/`encryptedGhanaCardNumber` (PII) |
| `RefreshToken*` | Auth | stored in Redis, not Postgres |
| `AuditLog` | Audit | append-only |
| `VerificationEvent` | Verification | tier transitions |
| `Listing`, `ListingMedia` | Listings | `variety`, `qualityAttrs Json?`, geo |
| `Inquiry` | Inquiries | offer + status |
| `MessageThread`, `Message` | Messaging | one thread per inquiry |
| `Transaction` | Transactions | state machine + `pickupConfirmationCode` |
| `LedgerEntry` | Ledger | append-only, signed amounts |
| `CommissionRate`, `Commission`, `CommissionInvoice` | Commissions | monthly accrual/invoice |
| `Rating`, `ReputationSnapshot` | Ratings / Reputation | recency-weighted |
| `SupportTicket` | Support | manual resolution |
| `ModerationCase` | Moderation | review queue |
| `ContentPiece`, `ContentLocale` | Content | EN/TW |
| `QASubmission` | QA | triage queue |
| `ScenarioRun` | Scenarios | inputs + cost buildup + outputs |
| `AgentVisit` | Agents | T3/T4 evidence |
| `NotificationLog` | Notifications | SMS audit |

Shared enums: `Locale {EN TW EE DA}` (only EN/TW translated in Phase 0),
`VerificationTier {T0 T1 T2 T3 T4}`, `UserStatus {ACTIVE SUSPENDED BANNED}`,
`Role {FARMER BUYER AGGREGATOR INPUT_SUPPLIER INVESTOR FIELD_AGENT REGIONAL_SUPERVISOR
AGRONOMIST TREASURY_OFFICER COMPLIANCE_OFFICER TRUST_REVIEWER ADMIN}`,
`ListingType {PRODUCE INPUT EQUIPMENT SERVICE LAND OFFTAKE_DEMAND}`,
`ListingStatus {DRAFT ACTIVE HELD WITHDRAWN SOLD EXPIRED}`, `Currency {GHS USD GBP EUR}`.

---

## 8. Module specifications

Each module: **purpose**, **models**, **endpoints**, **events** (emit/consume), **jobs**,
**UI hooks unblocked**, **tests**. Built in the §9 sequence.

### 8.1 ConfigModule
- **Purpose:** typed, validated env. **Models:** none.
- **Detail:** `env.schema.ts` + `env.validation.ts`; crash on missing required var.
- **Tests:** validation rejects bad/missing env.

### 8.2 Common / PrismaModule
- **Purpose:** `PrismaService` (soft-delete extension), `Money`, guards, decorators,
  interceptors, filter, `error-codes.ts`, correlation-id middleware.
- **Tests:** `Money` arithmetic/format; soft-delete extension filters `deletedAt`;
  `AllExceptionsFilter` envelope; `TierGuard` ordinal logic.

### 8.3 HealthModule
- **Endpoints:** `GET /v1/health` (Terminus: db + redis). **Tests:** returns `{status:"ok"}`.

### 8.4 UsersModule
- **Purpose:** user identity + profile. **Models:** `User`, `UserRole`.
  - `User`: `id`, `phone @unique`, `email? @unique`, `displayName`, `orgName?`,
    `preferredLocale`, `defaultRegionCode?`, `verificationTier @default(T0)`, `status`,
    `encryptedGhanaCardNumber?`, `encryptedFullName?`, relations, timestamps,
    `@@index([phone])`, `@@index([verificationTier])`.
  - `UserRole`: `userId`, `role`, `@@unique([userId, role])`.
- **Endpoints:** `GET /v1/me`, `PATCH /v1/me` (self profile), admin CRUD
  (`@RequireRole(ADMIN)`): `GET/PATCH /v1/users/:id`, role grant/revoke.
- **Events:** none emitted; consumed by none. **UI:** `useCurrentUser()`.
- **Tests:** profile read/update; PII never serialized; admin gating.

### 8.5 AuthModule
- **Purpose:** phone OTP, JWT, refresh rotation. **Models:** none (Redis-backed).
- **Endpoints:** `POST /v1/auth/request-otp`, `POST /v1/auth/verify-otp`,
  `POST /v1/auth/refresh`, `POST /v1/auth/logout`.
- **Detail:** OTP hash in Redis (5-min TTL, attempt-limited); access JWT 15 min, refresh
  30 days (rotate on use); HttpOnly cookies; first verify promotes T0→T1 (emits
  `verification.tier-changed`). Hubtel SMS via the notifications queue.
- **Events:** emits `verification.tier-changed`. **UI:** sign-in / verify-otp pages.
- **Tests:** OTP issue/verify happy + expiry + wrong-code lockout; refresh rotation;
  tier promotion on first verify. **e2e (critical):** OTP sign-up → T1.

### 8.6 AuditModule
- **Purpose:** automatic + explicit audit. **Models:** `AuditLog` (append-only:
  `actorUserId?`, `action`, `entityType`, `entityId?`, `ip?`, `userAgent?`, `correlationId`,
  `before Json?`, `after Json?`, `createdAt`).
- **Detail:** `AuditInterceptor` (global), `AuditService.record()`; PII scrubbed.
- **Endpoints:** admin read `GET /v1/audit` (filter by actor/entity). **Tests:** mutating
  request writes a row; sensitive fields scrubbed.

### 8.7 KycModule
- **Purpose:** NIA GhanaCard verification (T2). **Integration:** `integrations/nia`.
- **Endpoints:** `POST /v1/kyc/ghanacard` (submit card no. + selfie ref) → verify →
  on match promote T1→T2. **Events:** emits `verification.tier-changed`.
- **Detail:** GhanaCard number encrypted at rest; synchronous verify with worker retry on
  transient NIA failure. **Tests:** match→T2; mismatch→error code; retry on transient.

### 8.8 VerificationModule
- **Purpose:** tier state machine + history. **Models:** `VerificationEvent`
  (`userId`, `fromTier`, `toTier`, `method`, `evidenceRef?`, `actorUserId?`, `createdAt`).
- **Endpoints:** `GET /v1/users/:id/verification` (history + current tier).
- **Detail:** the only writer of `User.verificationTier`; validates legal transitions;
  every change audited. **Consumes:** tier-change requests from Auth/KYC/Agents.
- **Tests:** legal vs illegal transitions; event written + emitted.

### 8.9 ListingsModule
- **Purpose:** produce listings (maize/tomato). **Models:** `Listing`, `ListingMedia`.
  - `Listing`: `id`, `sellerId`, `type @default(PRODUCE)`, `crop`, `variety?`,
    `quantityUnits Int`, `unitLocal`, `unitKgOverride?`, `quantityKg BigInt`,
    `priceMinor BigInt`, `currency @default(GHS)`, `regionCode`, `districtCode?`,
    `geo? (lat/lng)`, `qualityAttrs Json?`, `status @default(DRAFT)`, `lotId @unique`,
    `expiresAt?`, timestamps, `@@index([crop, regionCode, status])`, `@@index([sellerId])`.
  - `ListingMedia`: `id`, `listingId`, `kind (PHOTO|VOICE)`, `storageKey`, `order`,
    `gps?`, `durationSec?`, `createdAt`.
- **Endpoints:** `GET /v1/listings` (filter crop/region/status/seller, paginated),
  `GET /v1/listings/:id`, `POST /v1/listings` (`@RequireTier(T1)`),
  `PATCH /v1/listings/:id` (owner guard), `DELETE` (soft, owner),
  `GET /v1/listings/:id/inquiries`.
- **Detail:** `lotId` generated `AZ-YY-{MZ|TM}-{n}`; `quantityKg` normalized via
  `kgPerUnit` (bag 100 / crate 50) + `unitKgOverride`; `priceStatus` computed against the
  Intelligence reference band; `title` composed in the response DTO; Mapbox geocoding on
  create.
- **Events:** emits `listing.created`, `listing.status-changed`. **Jobs:** enqueues
  `image-processing` for new photos. **UI:** `useFeed`, `useMyListings`, `useListing`,
  `postListing`. **Tests:** create normalizes kg + generates lotId; tier gate; owner guard;
  response DTO matches UI `Listing`. **e2e (critical):** create listing end-to-end.

### 8.10 FilesModule
- **Purpose:** signed-URL uploads + image pipeline. **Models:** none (keys on `ListingMedia`).
- **Endpoints:** `POST /v1/files/sign` (returns presigned PUT for S3-compatible storage),
  `POST /v1/files/complete` (notify upload done → attach to listing/message).
- **Jobs (`image-processing`):** compress, **strip EXIF**, extract GPS (for verification)
  before storage. **Detail:** voice notes accept webm/opus. **Tests:** sign returns scoped
  URL; complete attaches media; worker strips EXIF + records GPS.

### 8.11 SearchModule
- **Purpose:** marketplace search/filter. **Models:** none (Postgres FTS + indices on
  `Listing`). **Endpoints:** folded into `GET /v1/listings` query params (crop, region,
  price range, tier, text). **Tests:** filter correctness; FTS ranking sane.

### 8.12 InquiriesModule
- **Purpose:** offers + negotiation state. **Models:** `Inquiry`
  (`id`, `listingId`, `buyerId`, `sellerId`, `quantityUnits`, `unitLocal`,
  `offerPriceMinor BigInt`, `status (SENT|COUNTERED|ACCEPTED|DECLINED|CONVERTED)`,
  `lastActorId`, timestamps, `@@index([listingId])`, `@@index([buyerId])`).
- **Endpoints:** `GET /v1/inquiries?role=buyer|seller`, `GET /v1/inquiries/:id`,
  `POST /v1/inquiries` (creates inquiry + opens message thread with the opening offer),
  `POST /v1/inquiries/:id/counter`, `POST /v1/inquiries/:id/accept`,
  `POST /v1/inquiries/:id/decline`.
- **Detail:** `accept` is the seam to Transactions — it creates a `Transaction(CONFIRMED)`,
  sets listing `HELD`, inquiry `ACCEPTED`/`CONVERTED`, emits `inquiry.accepted`. The UI's
  composed inquiry status (`pickup`/`paid`) is derived from the linked transaction at read.
- **Events:** emits `inquiry.created`, `inquiry.accepted`, `inquiry.declined`.
  **UI:** `useFarmerInbox`, `useBuyerInbox`, `useInquiriesFor`, `useInquiry`, `sendInquiry`,
  `counter`, `accept`, `decline`. **Tests:** state transitions; accept creates transaction +
  holds listing; role-scoped listing. **e2e (critical):** express interest → accept.

### 8.13 MessagingModule
- **Purpose:** in-app negotiation thread (stub; SMS as notification only). **Models:**
  `MessageThread` (`id`, `inquiryId @unique`), `Message` (`id`, `threadId`, `senderId`,
  `type (MSG|VOICE|OFFER|COUNTER|ACCEPT)`, `text?`, `voiceMediaId?`, `durationSec?`,
  `priceMinor?`, `quantityUnits?`, `createdAt`).
- **Endpoints:** `GET /v1/inquiries/:id/messages`, `POST /v1/inquiries/:id/messages`
  (text or voice). **Detail:** offer/counter/accept messages are written by Inquiries on the
  same thread, so `history` reads as one timeline (matches UI `Inquiry.history`).
  **UI:** `addMessage`. **Tests:** message append; voice note shape; thread ordering.

### 8.14 TransactionsModule
- **Purpose:** settlement lifecycle (off-platform recorded). **Models:** `Transaction`
  (`id`, `inquiryId @unique`, `listingId`, `sellerId`, `buyerId`, `agreedPriceMinor BigInt`,
  `quantityUnits`, `quantityKg BigInt`, `grossMinor BigInt`, `commissionMinor BigInt`,
  `netMinor BigInt`, `status (CONFIRMED|PICKUP_SCHEDULED|PICKUP_DONE|DELIVERED|COMPLETED|CANCELLED)`,
  `pickupAt?`, `pickupConfirmationCode?`, `settledAt?`, timestamps).
- **Endpoints:** `GET /v1/transactions/:id`, `GET /v1/transactions?role=`,
  `POST /v1/transactions/:id/pickup` (schedule; → `PICKUP_SCHEDULED`),
  `POST /v1/transactions/:id/confirm-pickup` (4-digit code → `PICKUP_DONE`),
  `POST /v1/transactions/:id/complete` (record settlement → `COMPLETED`).
- **Detail:** `complete` appends `LedgerEntry`, triggers commission accrual, sets listing
  `SOLD`, emits `transaction.completed`. Escrow/Payments calls go through their interface
  modules (which throw in Phase 0) — wired but unused, so Phase 2 fills them in without
  changing this module.
- **Events:** consumes `inquiry.accepted`; emits `transaction.completed`,
  `transaction.status-changed`. **UI:** `schedulePickup`, `releasePayment`, pickup flow.
  **Tests:** full state machine; complete writes ledger + accrues commission + marks sold;
  illegal transitions rejected. **e2e (critical):** confirm a transaction through completion.

### 8.15 LedgerModule
- **Purpose:** append-only financial record + wallet read-model. **Models:** `LedgerEntry`
  (`id`, `account`, `entryType (SETTLEMENT_RECORDED|COMMISSION_ACCRUED|ADJUSTMENT)`,
  `transactionId?`, `amountMinor BigInt` (signed), `currency`, `createdAt` — **no updates,
  no deletedAt**).
- **Endpoints:** `GET /v1/wallet/me` (balance = Σ entries for the account),
  `GET /v1/ledger?account=` (admin/treasury). **UI:** `useWalletBalance`.
  **Tests:** append-only enforced; balance sums correctly; commission reduces net.

### 8.16 EscrowModule (interface only)
- **Purpose:** Phase 2 placeholder. **Detail:** exposes `EscrowService` with
  `hold/release/freeze/refund`, each throwing `NotImplementedException('Escrow is Phase 2')`.
  No schema. Transactions depends on the interface so Phase 2 is a drop-in.
  **Tests:** methods throw the expected exception (lock the contract).

### 8.17 PaymentsModule (interface only)
- **Purpose:** Phase 1 placeholder for MoMo/cards. **Detail:** `PaymentsService` surface
  defined; methods throw `NotImplementedException`. **Tests:** contract lock.

### 8.18 CommissionsModule
- **Purpose:** configurable rates + monthly invoicing. **Models:** `CommissionRate`
  (`productType`, `rateBps`, `effectiveFrom`), `Commission` (`transactionId`, `rateBps`,
  `baseMinor`, `amountMinor`, `invoiceId?`, `status (ACCRUED|INVOICED|PAID)`),
  `CommissionInvoice` (`accountId`, `periodStart`, `periodEnd`, `totalMinor`,
  `status (DRAFT|ISSUED|PAID)`).
- **Endpoints:** admin `GET/POST /v1/commissions/rates`, `GET /v1/commissions/invoices`,
  `POST /v1/commissions/invoices/run` (period). **Jobs (`reconciliation`):** monthly invoice
  generation per buyer/aggregator account. **Detail:** default rate 1.5% (150 bps); accrues
  on `transaction.completed` — **no transaction-time collection**.
- **Events:** consumes `transaction.completed`. **Tests:** accrual on completion; monthly
  rollup; rate config respected.

### 8.19 ModerationModule
- **Purpose:** review queue + actions. **Models:** `ModerationCase` (`subjectType`,
  `subjectId`, `reason`, `status`, `assigneeId?`, `resolution?`).
- **Endpoints:** `GET /v1/moderation/queue`, `POST /v1/moderation/:id/{hold,release,
  suspend,ban}` (`@RequireRole`). **Events:** consumes `listing.created` (queues image
  check). **Tests:** queue + each action effect; gated to staff roles.

### 8.20 SupportModule
- **Purpose:** manual support tickets (replaces formal disputes in Phase 0). **Models:**
  `SupportTicket` (`userId`, `subject`, `body`, `status (OPEN|IN_PROGRESS|RESOLVED)`,
  `assigneeId?`). **Endpoints:** `POST /v1/support/tickets`, `GET /v1/support/tickets`
  (self + staff), `PATCH /v1/support/tickets/:id` (staff). **Detail:** no automated state
  machine; resolution off-platform. **Tests:** create + staff transitions.

### 8.21 RatingsModule
- **Purpose:** post-completion ratings. **Models:** `Rating` (`raterId`, `rateeId`,
  `transactionId`, `score 1-5`, `comment?`). **Endpoints:** `POST /v1/transactions/:id/rating`,
  `GET /v1/users/:id/ratings`. **Detail:** only parties of a `COMPLETED` transaction may
  rate. **Events:** emits `rating.created`. **Tests:** eligibility gate; one rating per party.

### 8.22 ReputationModule
- **Purpose:** recency-weighted reputation snapshots. **Models:** `ReputationSnapshot`
  (`userId`, `score`, `breakdown Json`, `computedAt`). **Jobs (`reputation-recompute`):**
  recompute on `rating.created`/`transaction.completed`. **Endpoints:**
  `GET /v1/users/:id/reputation`. **Tests:** recency weighting; recompute trigger.

### 8.23 ContentModule
- **Purpose:** knowledge library, EN/TW. **Models:** `ContentPiece` (`slug`, `category`,
  `status`, `publishedAt?`), `ContentLocale` (`contentPieceId`, `locale (EN|TW)`, `title`,
  `body`). **Endpoints:** `GET /v1/content`, `GET /v1/content/:slug`, admin publish
  workflow. **Tests:** publish workflow; locale fallback EN.

### 8.24 QAModule
- **Purpose:** question submission + triage. **Models:** `QASubmission` (`askedById`,
  `question`, `status (NEW|TRIAGED|ANSWERED)`, `answer?`, `answeredById?`). **Endpoints:**
  `POST /v1/qa`, `GET /v1/qa` (staff triage), `POST /v1/qa/:id/answer`. **Tests:** triage
  flow; answer notifies asker.

### 8.25 NotificationsModule
- **Purpose:** SMS-only outbound (Hubtel). **Models:** `NotificationLog` (`userId`,
  `channel (SMS)`, `template`, `payload Json`, `status (QUEUED|SENT|FAILED)`,
  `providerMessageId?`). **Jobs (`notifications`):** `send-sms` via `HubtelService`.
  **Endpoints:** `GET /v1/notifications/me`; channel preferences on `User` include
  WhatsApp/email fields but **only SMS is wired**. **Webhooks:** Hubtel delivery receipts
  (via WebhooksModule) update `NotificationLog`. **Events:** consumes many (`inquiry.*`,
  `transaction.*`, OTP). **Tests:** enqueue + send; delivery webhook updates status.

### 8.26 WebhooksModule
- **Purpose:** inbound webhook intake. **Endpoints:** `POST /v1/webhooks/hubtel` (SMS
  delivery only in Phase 0). **Detail:** verifies signature, dispatches to the owning
  module's handler, acknowledges. **Tests:** signature verify; dispatch + ack; replay-safe.

### 8.27 IntelligenceModule
- **Purpose:** data ingestion + typed query surface for the Advisor and the reference-price
  band. **Integrations:** Open-Meteo, NASA POWER, MOFA SRID/Esoko. **Models:** ingested
  series tables (weather, climate, yield, price) + a `ReferencePrice` cache.
- **Endpoints:** internal typed services (`getYieldDistribution`, `getPriceHistory`,
  `getReferencePriceBand(crop, region)`); `GET /v1/reference-prices?crop=&region=` for the
  UI price band. **Jobs:** `weather-refresh` (daily), `reference-price` (batch).
  **Consumers:** Listings (`priceStatus`), Scenarios. **Tests:** ingestion idempotent;
  band query; cache refresh.

### 8.28 ScenariosModule (Investment Advisor)
- **Purpose:** scenarios, cost build-up, Monte Carlo. **Models:** `ScenarioRun` (`userId`,
  `title`, `cropFocus`, `regionCode`, `horizon`, `inputs Json {capital, procurementWeeks,
  bags, holdingWeeks}`, `costBuildup Json`, `roiLow`, `roiHigh`, `roiMode`, `probability`,
  `confidence`, timestamps).
- **Endpoints:** `GET /v1/advisor/scenarios` (default + user's), `POST /v1/advisor/scenarios`
  (from profile), `GET /v1/advisor/scenarios/:id`, `POST /v1/advisor/scenarios/:id/recompute`
  (edited inputs → live cost build-up + re-run), `POST /v1/advisor/scenarios/:id/email`
  (HTML-email summary to a recipient address).
- **Detail:** the cost build-up reproduces the UI's `COST_LINES` model exactly (defaults
  match the design; each line scales by its driver). ROI band/probability/confidence come
  from a Monte Carlo engine (10,000 iterations) over Intelligence series. **Advisor is free**
  — no subscription, no paywall, no PDF (email summary only).
- **UI:** advisor scenarios list + detail + recompute. **Tests:** cost build-up matches the
  reference at defaults and scales on edits; Monte Carlo deterministic under seed; email
  summary renders. **e2e (critical):** open + view a scenario.

### 8.29 AgentsModule
- **Purpose:** field-agent visits → T3/T4. **Models:** `AgentVisit` (`agentId`, `farmerId`,
  `listingId?`, `geo`, `photoMediaIds`, `voiceAttestationMediaId?`, `outcome`, `createdAt`).
- **Endpoints:** `POST /v1/agents/visits` (`@RequireRole(FIELD_AGENT)`) → on confirmed
  identity+farm promote to T3; produce inspection → T4. **Events:** emits
  `verification.tier-changed`. **Detail:** the agent **PWA is frontend-only and not built in
  this UI pass** (FRONTEND.md §8) — this backend module still exposes the endpoints the PWA
  will call. **Tests:** visit → T3; inspection → T4; role gate.

### 8.30 ActivityModule
- **Purpose:** the persona activity feed (`useActivity`). **Models:** none required — derive
  from `AuditLog`/domain events, or a lightweight `ActivityItem` projection table populated
  by event subscribers. **Decision:** use a **projection table** `ActivityEntry`
  (`actorId`, `persona (FARMER|BUYER)`, `text`, `refType`, `refId`, `createdAt`) written by
  subscribers to `listing.created`, `inquiry.*`, `transaction.*` — cheaper to read than
  reconstructing from audit. **Endpoints:** `GET /v1/activity?persona=`. **UI:** `useActivity`.
  **Tests:** events append entries; persona filter.

---

## 9. Build sequence

Each step gated by green CI before the next starts (BACKEND.md §11). Modules grouped to
match the gating. UI surfaces each step unblocks are noted.

**Step 1 — Foundation.** ConfigModule, Common/Prisma (soft-delete ext, Money, global pipe/
filter/interceptor, error codes, correlation id), Health, Pino, Sentry (wired, no events),
Swagger `/v1/docs`, `docker-compose.yml` (pg+redis), `.env.example`, CI (lint, type-check,
unit, build, prisma validate).

**Step 2 — Identity.** Users, Auth (OTP+JWT+refresh), guards/decorators, Audit. *Unblocks:*
sign-in, verify-otp, `/me`, role gating.

**Step 3 — KYC & Verification.** Kyc (NIA), Verification (state machine), VerificationEvent.
*Unblocks:* tier badges driven by real tiers.

**Step 4 — Marketplace core.** Listings, Files, Search, Inquiries, Messaging. *Unblocks:*
feed, listing detail, create-listing wizard, farmer/buyer inbox, negotiation threads.

**Step 5 — Transactions, Commission & Ledger.** Transactions, Ledger, Commissions, Escrow
(interface), Payments (interface), Activity. *Unblocks:* accept→pickup→complete, wallet,
activity feed.

**Step 6 — Trust ops.** Moderation, Support, Ratings, Reputation. *Unblocks:* ratings,
moderation, reputation surfaces.

**Step 7 — Knowledge & Notifications.** Content (EN/TW), QA, Notifications (SMS), Webhooks.
*Unblocks:* library, Q&A, SMS notifications + delivery receipts.

**Step 8 — Advisor.** Intelligence (ingestion + reference price), Scenarios (cost build-up,
Monte Carlo, email summary), Agents (verification endpoints). *Unblocks:* `/invest` surfaces;
reference-price band on listings.

**Step 9 — Hardening.** Query plans / missing indices / N+1, k6 load, pentest prep, docs.

---

## 10. Testing & CI

- **Unit** (`*.spec.ts`, Prisma mocked): services + utilities; ~70% coverage target on
  `*.service.ts`.
- **Module integration** (`__tests__/`, `@nestjs/testing` + dockerized Postgres): real-DB
  module behaviour.
- **E2E** (`test/`, supertest, seeded DB): the four critical paths — (1) OTP sign-up →
  T1→T2; (2) create listing → search → inquiry → accept → pickup → complete; (3) advisor
  scenario create + view; (4) Hubtel SMS delivery webhook handling.
- **CI** on every PR: lint, type-check, unit, build, `prisma migrate diff`/validate; e2e
  against the seeded Docker backend.

Seed data should mirror the UI's `marketplace.ts` seeds (Adwoa/Yaa/Akosua personas, the
listing/inquiry fixtures) so the contract is exercised against known shapes and the UI can
run against a real backend with the same demo state.

---

## 11. Environment variables

Validated on startup; missing required = crash. Phase 0 required:
`DATABASE_URL`, `DIRECT_DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `JWT_ACCESS_TTL`,
`JWT_REFRESH_TTL`, `HUBTEL_CLIENT_ID`, `HUBTEL_CLIENT_SECRET`, `HUBTEL_SENDER_ID`,
`NIA_API_KEY`, `NIA_API_URL`, `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`,
`S3_REGION`, `OPEN_METEO_API_URL`, `NASA_POWER_API_URL`, `MAPBOX_TOKEN`, `SENTRY_DSN`,
`PII_ENCRYPTION_KEY` (32-byte base64), `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS`.

**Do NOT configure in Phase 0** (Phase 1+): `SMILE_ID_*`, `COMPLY_ADVANTAGE_API_KEY`,
`PAYSTACK_SECRET_KEY`, `FLUTTERWAVE_SECRET_KEY`, `STRIPE_SECRET_KEY`, `WHATSAPP_API_*`,
`HUBTEL_MOMO_*`, `ESCROW_TRUST_ACCOUNT_ID`. The example file shows shape, never secrets.

CORS allows the three frontend origins; the UI expects the API at
`NEXT_PUBLIC_API_URL=http://localhost:3000/v1`.

---

## 12. Risks & open questions

1. **Port collision.** The UI dev server runs on `:3000` and FRONTEND.md points
   `NEXT_PUBLIC_API_URL` at `http://localhost:3000/v1`. The backend also defaults to `:3000`.
   For local dev, run the API on a different port (e.g. `:3001`) and set the UI's
   `NEXT_PUBLIC_API_URL` accordingly, or proxy. **To confirm during Step 1.**
2. **`distance` field.** The UI shows a per-listing distance to the buyer. Phase 0 will use a
   region-centroid approximation; true distance needs buyer geolocation. Acceptable for
   Phase 0; flag if precise distance is required.
3. **Composed inquiry status.** The UI collapses transaction state (`pickup`/`paid`) into the
   inquiry status enum. The adapter composes it; confirm the UI hook is the right place to
   merge (it is, per their CLAUDE.md) vs. the API returning a pre-composed status.
4. **Activity feed source.** Chose a projection table over audit-log reconstruction (§8.30);
   revisit if the feed needs richer/per-user filtering than the projection captures.
5. **Tier gate for listing creation.** Set to `≥ T1` (phone). If the product wants ID-verified
   sellers only, raise to `≥ T2` — one decorator change.
6. **UI build sequence drift.** FRONTEND.md's own build sequence (§11) still references MoMo,
   Stripe subscriptions, and PDF export — superseded by D1. The backend follows this spec's
   §9, not FRONTEND.md §11, for those areas.
```
