# AgriZone Backend — Implementation Guide

**For:** Claude Code
**Stack:** NestJS 10 + TypeScript + Prisma + PostgreSQL + Redis + BullMQ
**Scope:** Phase 0 only (months 0–6). Do not implement Phase 1+ features unless explicitly asked.

This document is the operating manual. Read it in full before starting any task. When in doubt about a pattern, return to this document — do not invent a new pattern.

---

## 1. Project context (read once, then refer back)

AgriZone is a digital agriculture platform for Ghana. The backend serves four frontends from a single API: a public web app (marketplace + advisor), a field-agent PWA, and an internal admin console. The wedge for Phase 0 is **maize + tomato in Ashanti + Bono East regions**.

The backend is a **modular monolith**. One deployable NestJS application, structured as feature modules. Module boundaries are enforced by linting. Do not split into microservices.

**Regulatory posture:** AgriZone is a facilitator. It does not hold funds, lend money, or underwrite insurance on its own. Every financial activity flows through a licensed partner. In Phase 0 this is enforced trivially because the platform handles no in-platform money — commissions are invoiced monthly to buyer/aggregator accounts and `EscrowModule` is interface-only. The architecture and module boundaries are nonetheless designed so `PaymentsModule`, `EscrowModule`, and `LedgerModule` can be filled in for Phase 1+ without rework.

**Audit and reversibility are non-negotiable.** Every state-changing action writes to `AuditLog`. Every financial event lands in the `Ledger`. Deletions are soft (`deleted_at`), never hard.

### Phase 0 scope decisions (revised)

The following capabilities have been **deferred to Phase 1+**. Do not implement them in Phase 0 unless explicitly told otherwise. Where an interface is required for forward-compatibility, that is called out below.

| Capability | Phase 0 state | Notes |
|---|---|---|
| In-platform payments (MoMo / cards) | **Not implemented.** Hubtel SMS-only integration. | Commission is **invoiced monthly**, not collected at transaction. Transactions settle off-platform; AgriZone records them post-hoc. |
| Escrow | **Interface only.** Implementation deferred to Phase 2. | Build `EscrowModule` as an empty module exposing a typed service interface so Phase 2 fills it in without rework. No partner trust account negotiation in Phase 0. |
| Card payment gateways (Paystack, Flutterwave, Stripe) | **Not integrated.** | Advisor is free in Phase 0; no subscription billing. |
| Smile ID liveness | **Not integrated.** | T1 = phone OTP + GhanaCard NIA only. Liveness added in Phase 1. |
| ComplyAdvantage sanctions/PEP | **Not integrated.** | Phase 0 is **Ghana-resident-only**. Diaspora users are Phase 1, and sanctions screening enters at that point. |
| WhatsApp Business API | **Not integrated.** | SMS-only notifications in Phase 0. |
| Formal dispute module | **Replaced by manual support.** | A simple `SupportTicketModule` records issues; resolution is handled by a human on phone/WhatsApp. Build the structured `DisputesModule` in Phase 1. |
| Investment Advisor subscription tiers | **Not implemented.** Advisor is free. | No billing logic, no paywall. |
| Advisor PDF export + share links | **Replaced by email summary.** | Server-rendered HTML email of the scenario, sent to a recipient address. |
| Multi-language launch | **English + Twi only.** | Wedge is Ashanti + Bono East (Twi-speaking). Keep the `Locale` enum with `EN, TW, EE, DA` values — only EN and TW need translation files in Phase 0. |

**What this changes operationally:**
- No PSP integration needed for Phase 0 launch. The PSP Enhanced license application timeline is unchanged (kicks off month 3) but the integration work is deferred to Phase 1.
- No trust-account bank partnership needed for Phase 0 launch.
- Commission revenue is recognized on invoice, not on transaction. The reconciliation engine is simpler.
- Estimated Phase 0 timeline tightens from ~24 weeks to ~16–20 weeks. Use the time saved for hardening, user research, or pulling Phase 1 priorities forward.

---

## 2. Stack and exact versions

Use these versions. Do not upgrade without explicit approval.

```json
{
  "node": "20.x LTS",
  "pnpm": "9.x",
  "nestjs": "^10.3.0",
  "typescript": "^5.4.0",
  "prisma": "^5.14.0",
  "postgres": "16.x",
  "redis": "7.x",
  "bullmq": "^5.7.0"
}
```

### Required dependencies

```bash
# NestJS core
@nestjs/core @nestjs/common @nestjs/platform-express
@nestjs/config @nestjs/cqrs @nestjs/event-emitter
@nestjs/jwt @nestjs/passport @nestjs/swagger
@nestjs/throttler @nestjs/schedule @nestjs/terminus

# Database
@prisma/client prisma

# Auth
passport passport-jwt bcrypt argon2

# Validation
class-validator class-transformer

# Queues
bullmq @nestjs/bullmq

# HTTP
@nestjs/axios axios

# Utilities
date-fns nanoid zod
opossum  # circuit breaker

# Logging
nestjs-pino pino-http pino-pretty

# Observability
@sentry/node prom-client

# Testing
jest @nestjs/testing supertest @types/jest ts-jest
```

---

## 3. Setup commands

Run these in order on first setup. Do not skip steps.

```bash
# From repo root
pnpm install
docker compose up -d  # starts postgres + redis locally

cd apps/api
cp .env.example .env  # fill in values
pnpm prisma migrate dev
pnpm prisma generate
pnpm run start:dev
```

Verify: `curl http://localhost:3000/v1/health` returns `{"status":"ok"}`.

---

## 4. Repository structure

```
apps/api/
├── src/
│   ├── main.ts                     # bootstrap, global setup
│   ├── app.module.ts                # root module
│   ├── config/                      # ConfigModule with typed schemas
│   │   ├── config.module.ts
│   │   ├── env.validation.ts
│   │   └── env.schema.ts
│   ├── common/                      # cross-cutting concerns ONLY
│   │   ├── decorators/              # @CurrentUser, @RequireRole, @RequireTier
│   │   ├── guards/                  # JwtAuthGuard, RolesGuard, TierGuard
│   │   ├── interceptors/            # AuditInterceptor, LoggingInterceptor
│   │   ├── filters/                 # AllExceptionsFilter
│   │   ├── pipes/                   # validation pipes
│   │   └── middleware/              # correlation ID, etc
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── kyc/                     # NIA GhanaCard only in Phase 0
│   │   ├── verification/
│   │   ├── listings/
│   │   ├── search/
│   │   ├── inquiries/
│   │   ├── messaging/
│   │   ├── transactions/            # off-platform settlement in Phase 0
│   │   ├── payments/                # invoicing only in Phase 0 (no MoMo/card)
│   │   ├── escrow/                  # interface only; Phase 2 implementation
│   │   ├── ledger/
│   │   ├── commissions/             # invoiced monthly in Phase 0
│   │   ├── reputation/
│   │   ├── ratings/
│   │   ├── support/                 # manual support tickets; replaces DisputesModule in Phase 0
│   │   ├── moderation/
│   │   ├── agents/
│   │   ├── content/
│   │   ├── qa/
│   │   ├── notifications/           # SMS only in Phase 0
│   │   ├── scenarios/               # Advisor (free in Phase 0)
│   │   ├── intelligence/            # Data sources for Advisor
│   │   ├── audit/
│   │   ├── files/
│   │   └── webhooks/                # Hubtel SMS delivery webhooks only in Phase 0
│   ├── integrations/                # External service wrappers
│   │   ├── hubtel/                  # SMS only in Phase 0
│   │   ├── nia/                     # GhanaCard verification
│   │   ├── open-meteo/              # weather
│   │   ├── nasa-power/              # climate history
│   │   └── mapbox/                  # geocoding
│   └── workers/                     # BullMQ processors
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── test/
│   └── e2e/
├── .env.example
├── docker-compose.yml
├── tsconfig.json
├── nest-cli.json
└── package.json
```

**Boundaries:**
- `common/` contains code shared across multiple modules. If only one module uses it, it lives in that module.
- `integrations/` contains thin wrappers around external services. Business logic does not live here. Modules consume integrations via injected services.
- `workers/` contains BullMQ processors. They consume from queues and call into module services.

---

## 5. Module structure — every module follows this layout

```
src/modules/listings/
├── listings.module.ts               # @Module declaration
├── listings.controller.ts           # HTTP endpoints, thin
├── listings.service.ts              # Business logic, the meat
├── listings.repository.ts           # Prisma queries, isolated
├── dto/
│   ├── create-listing.dto.ts
│   ├── update-listing.dto.ts
│   ├── list-listings.dto.ts         # query params for GET /listings
│   └── listing-response.dto.ts      # response shape
├── entities/                        # If we need domain entities (we usually don't with Prisma)
├── guards/
│   └── listing-owner.guard.ts       # module-specific guards
├── events/
│   ├── listing-created.event.ts
│   └── listing-status-changed.event.ts
├── handlers/                        # If using CQRS event handlers
└── __tests__/
    ├── listings.service.spec.ts
    └── listings.controller.spec.ts
```

**Strict rule:** controllers call services. Services call repositories and other services (via DI). Repositories call Prisma. Do not call Prisma from controllers or services directly.

---

## 6. Database schema (Phase 0)

Defined in `prisma/schema.prisma`. Build incrementally — add models as you build the modules that own them.

Key conventions:
- IDs are CUIDs (`@default(cuid())`), not auto-increment integers.
- Every domain table has `created_at`, `updated_at`, `deleted_at` (nullable).
- Soft delete by setting `deleted_at`; queries filter `deleted_at: null` by default (use a Prisma extension).
- Money is stored as `BigInt` representing minor units (pesewas), not as `Float`. Never use `Float` for money.
- Timestamps are `DateTime` (Postgres `timestamptz`).
- Enum fields use Prisma `enum` types, not free-form strings.
- Foreign keys are explicit with `@relation`.

### Phase 0 models (skeleton)

```prisma
model User {
  id              String     @id @default(cuid())
  phone           String     @unique
  email           String?    @unique
  preferredLocale Locale     @default(EN)
  defaultRegionCode String?
  verificationTier VerificationTier @default(T0)
  roles           UserRole[]
  status          UserStatus @default(ACTIVE)

  // PII (encrypted at application layer)
  encryptedGhanaCardNumber String?
  encryptedFullName        String?

  farms           Farm[]
  listings        Listing[]
  inquiriesSent   Inquiry[]      @relation("buyer")
  ratingsGiven    Rating[]       @relation("rater")
  ratingsReceived Rating[]       @relation("ratee")
  paymentMethods  PaymentMethod[]
  scenarioRuns    ScenarioRun[]

  createdAt       DateTime   @default(now())
  updatedAt       DateTime   @updatedAt
  deletedAt       DateTime?

  @@index([phone])
  @@index([verificationTier])
}

enum Locale { EN TW EE DA }
enum VerificationTier { T0 T1 T2 T3 T4 }
enum UserStatus { ACTIVE SUSPENDED BANNED }

model UserRole {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  role      Role
  createdAt DateTime @default(now())

  @@unique([userId, role])
}

enum Role {
  FARMER
  BUYER
  AGGREGATOR
  INPUT_SUPPLIER
  INVESTOR
  FIELD_AGENT
  REGIONAL_SUPERVISOR
  AGRONOMIST
  TREASURY_OFFICER
  COMPLIANCE_OFFICER
  TRUST_REVIEWER
  ADMIN
}

model Listing {
  id              String          @id @default(cuid())
  sellerId        String
  seller          User            @relation(fields: [sellerId], references: [id])
  type            ListingType
  crop            String          // "maize" | "tomato" in Phase 0
  quantityKg      BigInt          // canonical kg
  unitLocal       String          // "bag" | "crate" | etc
  unitKgOverride  Int?            // user-overridden kg-per-unit
  priceMinor      BigInt          // GHS pesewas
  currency        Currency        @default(GHS)
  regionCode      String
  districtCode    String?
  status          ListingStatus   @default(DRAFT)
  lotId           String          @unique
  expiresAt       DateTime?
  media           ListingMedia[]
  inquiries       Inquiry[]

  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt
  deletedAt       DateTime?

  @@index([crop, regionCode, status])
  @@index([sellerId])
  @@index([lotId])
}

enum ListingType { PRODUCE INPUT EQUIPMENT SERVICE LAND OFFTAKE_DEMAND }
enum ListingStatus { DRAFT ACTIVE HELD WITHDRAWN SOLD EXPIRED }
enum Currency { GHS USD GBP EUR }

// Add models in Phase 0 as you build the modules that own them:
// ListingMedia, Inquiry, MessageThread, Message, Transaction,
// LedgerEntry, AuditLog, VerificationEvent, ReputationSnapshot,
// Rating, ContentPiece, ContentLocale, QASubmission, ScenarioRun,
// AgentVisit, SupportTicket, Commission, CommissionInvoice.
//
// Phase 2 models (do NOT create in Phase 0):
// EscrowHold, Payment, DisputeCase.
// EscrowModule exposes a service interface in Phase 0; no schema yet.
```

Add models in the migration that introduces their module. Do not pre-create empty tables.

---

## 7. Core patterns — follow these exactly

### 7.1 Controllers are thin

A controller validates input, dispatches to a service, returns a response DTO. It does not contain business logic.

```typescript
// src/modules/listings/listings.controller.ts
import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ListingsService } from './listings.service';
import { CreateListingDto } from './dto/create-listing.dto';
import { ListListingsDto } from './dto/list-listings.dto';
import { ListingResponseDto } from './dto/listing-response.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequireTier } from '../../common/decorators/require-tier.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { VerificationTier } from '@prisma/client';

@ApiTags('listings')
@Controller('v1/listings')
export class ListingsController {
  constructor(private readonly listings: ListingsService) {}

  @Get()
  @ApiOperation({ summary: 'Search and filter active listings' })
  async list(@Query() query: ListListingsDto): Promise<ListingResponseDto[]> {
    return this.listings.findMany(query);
  }

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<ListingResponseDto> {
    return this.listings.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @RequireTier(VerificationTier.T1)
  async create(
    @Body() dto: CreateListingDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ListingResponseDto> {
    return this.listings.create(user.id, dto);
  }
}
```

### 7.2 Services own business logic

```typescript
// src/modules/listings/listings.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ListingsRepository } from './listings.repository';
import { CreateListingDto } from './dto/create-listing.dto';
import { ListingCreatedEvent } from './events/listing-created.event';
import { ReferencePriceService } from '../intelligence/reference-price.service';
import { generateLotId } from '../../common/utils/lot-id';

@Injectable()
export class ListingsService {
  constructor(
    private readonly repo: ListingsRepository,
    private readonly events: EventEmitter2,
    private readonly referencePrice: ReferencePriceService,
  ) {}

  async create(sellerId: string, dto: CreateListingDto) {
    const lotId = generateLotId();
    const quantityKg = this.normalizeToKg(dto.quantity, dto.unitLocal, dto.unitKgOverride);

    const listing = await this.repo.create({
      sellerId,
      lotId,
      type: dto.type,
      crop: dto.crop,
      quantityKg,
      unitLocal: dto.unitLocal,
      unitKgOverride: dto.unitKgOverride,
      priceMinor: BigInt(dto.priceMinor),
      regionCode: dto.regionCode,
      districtCode: dto.districtCode,
      status: 'ACTIVE',
    });

    this.events.emit('listing.created', new ListingCreatedEvent(listing.id, sellerId));

    return this.toResponseDto(listing);
  }

  // ...
}
```

### 7.3 Repositories isolate Prisma

```typescript
// src/modules/listings/listings.repository.ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/services/prisma.service';
import { Prisma, Listing } from '@prisma/client';

@Injectable()
export class ListingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.ListingCreateInput): Promise<Listing> {
    return this.prisma.listing.create({ data });
  }

  findManyActive(where: Prisma.ListingWhereInput, take: number, skip: number) {
    return this.prisma.listing.findMany({
      where: { ...where, status: 'ACTIVE', deletedAt: null },
      take,
      skip,
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(id: string) {
    return this.prisma.listing.findFirst({ where: { id, deletedAt: null } });
  }

  // No business logic here. Pure data access.
}
```

### 7.4 DTOs with validation

Use `class-validator` + `class-transformer`. Decorate for both validation and Swagger.

```typescript
// src/modules/listings/dto/create-listing.dto.ts
import { IsEnum, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ListingType } from '@prisma/client';

export class CreateListingDto {
  @ApiProperty({ enum: ListingType })
  @IsEnum(ListingType)
  type!: ListingType;

  @ApiProperty({ example: 'maize' })
  @IsString()
  @MinLength(2)
  crop!: string;

  @ApiProperty({ example: 50 })
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ example: 'bag' })
  @IsString()
  unitLocal!: string;

  @ApiPropertyOptional({ example: 100, description: 'kg per local unit, if overriding regional default' })
  @IsInt()
  @Min(1)
  @IsOptional()
  unitKgOverride?: number;

  @ApiProperty({ example: 50000, description: 'Price per local unit, in minor units (pesewas)' })
  @IsInt()
  @Min(1)
  priceMinor!: number;

  @ApiProperty({ example: 'GH-AH' })
  @IsString()
  regionCode!: string;

  @ApiPropertyOptional({ example: 'GH-AH-EJU' })
  @IsString()
  @IsOptional()
  districtCode?: string;
}
```

**Never** accept raw Prisma input shapes on controllers. Always go through a DTO.

### 7.5 Response DTOs — serialize, never return Prisma models

```typescript
// src/modules/listings/dto/listing-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { Listing, ListingStatus, ListingType } from '@prisma/client';

export class ListingResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() lotId!: string;
  @ApiProperty({ enum: ListingType }) type!: ListingType;
  @ApiProperty() crop!: string;
  @ApiProperty() quantityKg!: string;       // BigInt serialized as string
  @ApiProperty() unitLocal!: string;
  @ApiProperty() priceMinor!: string;       // BigInt serialized as string
  @ApiProperty() currency!: string;
  @ApiProperty() regionCode!: string;
  @ApiProperty({ enum: ListingStatus }) status!: ListingStatus;
  @ApiProperty() createdAt!: string;

  static fromEntity(listing: Listing): ListingResponseDto {
    return {
      id: listing.id,
      lotId: listing.lotId,
      type: listing.type,
      crop: listing.crop,
      quantityKg: listing.quantityKg.toString(),
      unitLocal: listing.unitLocal,
      priceMinor: listing.priceMinor.toString(),
      currency: listing.currency,
      regionCode: listing.regionCode,
      status: listing.status,
      createdAt: listing.createdAt.toISOString(),
    };
  }
}
```

### 7.6 Authentication — JWT with phone OTP

OTP flow:
1. `POST /v1/auth/request-otp` → generates 6-digit code, stores hash in Redis with 5-min TTL, sends SMS via Hubtel worker.
2. `POST /v1/auth/verify-otp` → checks code, returns access token (15 min) + refresh token (30 days).
3. `POST /v1/auth/refresh` → swaps refresh token for new access token. Rotate refresh tokens.

```typescript
// src/common/guards/jwt-auth.guard.ts
import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthenticatedUser>(err: unknown, user: TUser): TUser {
    if (err || !user) throw new UnauthorizedException();
    return user;
  }
}
```

### 7.7 Authorization — role and tier decorators

```typescript
// src/common/decorators/require-role.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const RequireRole = (...roles: Role[]) => SetMetadata('roles', roles);

// src/common/decorators/require-tier.decorator.ts
import { SetMetadata } from '@nestjs/common';
import { VerificationTier } from '@prisma/client';

export const RequireTier = (tier: VerificationTier) => SetMetadata('minTier', tier);
```

Guards read these via Reflector and authorize accordingly. Tier comparison is ordinal: T0 < T1 < T2 < T3 < T4.

### 7.8 Audit logging — via interceptor

Every mutating endpoint is audited automatically. The interceptor reads metadata to know whether to write.

```typescript
// src/common/interceptors/audit.interceptor.ts
// Captures: actor user id, IP, user-agent, endpoint, before/after (where feasible), correlation id
// Writes to AuditLog asynchronously (does not block the response)
```

For state changes that need explicit audit detail (e.g., a verification tier change, a commission rate edit), call `AuditService.record(...)` from the service directly.

### 7.9 Domain events

Use `@nestjs/event-emitter` for in-process events. Pattern:

```typescript
// Emit
this.events.emit('listing.created', new ListingCreatedEvent(listingId, sellerId));

// Subscribe (in another module)
@OnEvent('listing.created')
async handleListingCreated(event: ListingCreatedEvent) {
  await this.moderation.queueImageCheck(event.listingId);
}
```

Events have **typed payloads**, no `any`. The payload class lives in the emitting module's `events/` folder and is imported by subscribers.

### 7.10 Error handling

Use NestJS built-in exceptions: `BadRequestException`, `UnauthorizedException`, `ForbiddenException`, `NotFoundException`, `ConflictException`. Never throw raw `Error` objects from a service.

A global filter catches anything else and renders a structured response with a correlation id:

```typescript
// src/common/filters/all-exceptions.filter.ts
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    // ... structured logging + Sentry + standard error response
  }
}
```

Error response shape (consistent across the API):

```json
{
  "error": {
    "code": "LISTING_NOT_FOUND",
    "message": "Listing not found",
    "correlationId": "01HXAY..."
  }
}
```

Define error codes in `src/common/errors/error-codes.ts` as an enum. The frontend reads `code`, not `message`, for branching logic.

### 7.11 Money — never use Float

All money is `BigInt` in minor units. Conversions and arithmetic happen via a `Money` value object in `src/common/value-objects/money.ts`. Never multiply or divide raw `BigInt` for money.

### 7.12 Soft delete

```typescript
// prisma extension to filter deleted_at: null by default
// applied in PrismaService constructor
```

Repositories opt out of the filter explicitly when they need to see soft-deleted records.

---

## 8. External integrations — the pattern

Every integration lives in `src/integrations/<name>/` and exposes an interface. Modules consume the interface, not the implementation.

**Phase 0 integrations** (only these are wired in Phase 0):

| Integration | Used by | Pattern |
|---|---|---|
| Hubtel SMS | NotificationsModule, AuthModule (OTP) | Worker-driven outbound; delivery webhook inbound. **SMS only in Phase 0 — no MoMo, no shortcode interactivity.** |
| NIA GhanaCard API | KycModule | Synchronous, with worker retry on transient failures |
| Open-Meteo (weather) | IntelligenceModule | Cached aggressively; refresh daily |
| NASA POWER (climate history) | IntelligenceModule | Cached aggressively; refresh quarterly |
| MOFA SRID / Esoko (yield, prices) | IntelligenceModule | Batch import via worker; manual partnership feeds |
| Mapbox (geocoding) | ListingsModule | Synchronous |
| Sentry (errors) | All | Direct SDK |
| PostHog (analytics) | Frontend only | Not in scope for backend |
| Cloudinary (image transforms) | FilesModule | Indirect — signed URLs only |

**Phase 1+ integrations** (do NOT integrate in Phase 0):

| Integration | Phase | Why deferred |
|---|---|---|
| Hubtel MoMo, Paystack, Flutterwave | Phase 1 | In-platform payments deferred |
| Smile ID | Phase 1 | T1 = NIA GhanaCard alone; liveness later |
| ComplyAdvantage | Phase 1 | Sanctions screening enters with diaspora users |
| WhatsApp Business API | Phase 1 | SMS-only in Phase 0 |
| Stripe | Phase 1 | No Advisor subscriptions in Phase 0 |
| Ghana Commodity Exchange | Phase 1+ | Partnership-dependent; Phase 0 Advisor uses public data only |

**Code example — Hubtel SMS wrapper.** This is the canonical integration pattern. Apply the same shape to NIA, Mapbox, and any future integration.

```typescript
// src/integrations/hubtel/hubtel.service.ts
import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import CircuitBreaker from 'opossum';

export interface SendSmsParams {
  to: string;        // E.164
  body: string;
  reference: string;
}

export interface SmsResult {
  messageId: string;
  status: 'sent' | 'queued' | 'failed';
}

@Injectable()
export class HubtelService {
  private smsBreaker: CircuitBreaker;

  constructor(private http: HttpService, private config: ConfigService) {
    this.smsBreaker = new CircuitBreaker(this.sendSmsRaw.bind(this), {
      timeout: 10_000,
      errorThresholdPercentage: 50,
      resetTimeout: 30_000,
    });
  }

  async sendSms(params: SendSmsParams): Promise<SmsResult> {
    return this.smsBreaker.fire(params);
  }

  private async sendSmsRaw(params: SendSmsParams): Promise<SmsResult> {
    // implementation against Hubtel SMS API
  }
}
```

Webhooks from Hubtel (SMS delivery receipts) land in `WebhooksModule`, which verifies signature, dispatches to the right module's handler, and acknowledges.

**Resilience:**
- Every integration call has a timeout, a retry policy, and a circuit breaker (via `opossum`).
- Failures are logged and metricised.
- Critical integrations (Hubtel for OTP, NIA for verification) have a documented partner-status page check that ops can verify.

---

## 9. Background jobs (BullMQ)

Queue names are constants in `src/workers/queue-names.ts`:

```typescript
export const QUEUES = {
  NOTIFICATIONS: 'notifications',           // Phase 0: SMS only
  IMAGE_PROCESSING: 'image-processing',
  RECONCILIATION: 'reconciliation',         // Phase 0: commission-invoice reconciliation only
  WEATHER_REFRESH: 'weather-refresh',
  REFERENCE_PRICE: 'reference-price',
  REPUTATION_RECOMPUTE: 'reputation-recompute',
  // Phase 1+ (do not add in Phase 0):
  // AML_SCREENING — added when ComplyAdvantage integrates
  // PAYMENT_RECONCILIATION — added when in-platform payments turn on
} as const;
```

Processor pattern:

```typescript
// src/workers/notifications.processor.ts
import { Processor, Process } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { HubtelService } from '../integrations/hubtel/hubtel.service';

@Processor(QUEUES.NOTIFICATIONS)
export class NotificationsProcessor {
  constructor(private hubtel: HubtelService) {}

  @Process('send-sms')
  async sendSms(job: Job<SendSmsJob>) {
    return this.hubtel.sendSms(job.data);
  }
}
```

Job constraints:
- **Idempotent.** Same job re-run produces the same outcome.
- **Bounded retry.** Default: 3 attempts with exponential backoff.
- **Dead letter.** Failed jobs after retries go to a DLQ for manual review.
- **Observability.** Each job logs start, end, duration. Failures send to Sentry.

---

## 10. Testing

Three levels:

1. **Unit tests** (`*.spec.ts` next to source). Test services and utilities with Prisma mocked. Use Jest + ts-jest.
2. **Module integration tests** (in `__tests__/`). Test a module with a real Postgres test database (Docker). Use `@nestjs/testing`'s `TestingModule`.
3. **E2E tests** (`test/e2e/`). Full HTTP requests against a fully-wired app with test database. Use supertest.

**Coverage target:** ~70% on `*.service.ts` files. Coverage on controllers and DTOs is lower priority.

**Critical paths that must have e2e tests in Phase 0:**
- Phone OTP sign-up + verification tier T0 → T1 → T2 path.
- Create listing → search → inquiry → confirm → escrow hold → release.
- Advisor scenario creation.
- Webhook handling for payment success and payment failure.

---

## 11. Phase 0 build sequence

Implement modules in this order. Do not start a step until the previous is green in CI. Total Phase 0 estimate **~16–20 weeks** with the scope cuts applied (down from ~24 weeks in the original plan).

### Step 1 — Foundation (Weeks 1–2)
- Monorepo, NestJS bootstrap, Prisma + Postgres + Redis via docker-compose.
- ConfigModule with typed env validation.
- Global pipes, filters, interceptors.
- Health check endpoint.
- Pino logger.
- Sentry wired (no events yet).
- Swagger at `/v1/docs`.
- CI: lint, type-check, unit tests, build.

### Step 2 — Identity (Weeks 3–4)
- `UsersModule`: User, UserRole models. CRUD on users (admin only). Profile read/update for self.
- `AuthModule`: phone OTP via Hubtel SMS, JWT issuance, refresh tokens in Redis.
- `JwtAuthGuard`, `RolesGuard`, `TierGuard`.
- `@CurrentUser`, `@RequireRole`, `@RequireTier` decorators.
- `AuditModule`: AuditLog model, AuditInterceptor, AuditService.

### Step 3 — KYC & Verification (Week 5)
*Smaller than the original plan — Smile ID and ComplyAdvantage are deferred to Phase 1.*
- `KycModule`: NIA GhanaCard verification only.
- `VerificationModule`: verification tier state machine (T0 → T1 via NIA, T1 → T2 via field-agent visit). Tier transitions emit events to AuditModule.
- VerificationEvent model.

### Step 4 — Marketplace core (Weeks 6–8)
- `ListingsModule`: Listing, ListingMedia models. CRUD with photo upload (signed URLs via S3-compatible).
- `FilesModule`: presigned upload URLs, image processing worker (compress, EXIF strip, extract GPS).
- `SearchModule`: Postgres full-text + filters.
- `InquiriesModule`: Inquiry model. Express-interest, accept, decline, counter.
- `MessagingModule` (stub): thread + message models, send/receive in-app. SMS delivery as a notification only.

### Step 5 — Transactions, Commission & Ledger (Weeks 9–10)
*Significantly leaner than the original plan — no in-platform payments, no escrow implementation.*
- `TransactionsModule`: Transaction state machine (CONFIRMED → PICKUP_SCHEDULED → PICKUP_DONE → DELIVERED → COMPLETED). Settlement happens off-platform; the platform records the confirmation post-hoc.
- `LedgerModule`: append-only LedgerEntry. Records commission accruals on completion.
- `CommissionsModule`: configurable commission rates per product type. Generates `CommissionInvoice` records monthly per buyer/aggregator account; **no transaction-time collection**.
- `EscrowModule`: **interface only.** Define `EscrowService` with method signatures (`hold`, `release`, `freeze`, `refund`) but each method throws `NotImplementedException('Escrow is Phase 2')`. This keeps consumer code (TransactionsModule) forward-compatible.
- `PaymentsModule`: **interface only.** Same pattern. Define the service surface for future MoMo/card integration.

### Step 6 — Trust ops (Weeks 11–12)
*The formal DisputesModule is replaced by a simpler SupportTicketModule.*
- `ModerationModule`: review queue, action handlers (hold/release/suspend/ban).
- `SupportModule`: SupportTicket model. Users submit issues via a simple form; tickets land in a queue. Resolution is by a human operator (phone, WhatsApp, email outside the platform). No automated state machine.
- `RatingsModule`: ratings post-completion, weighted by recency.
- `ReputationModule`: reputation snapshot generation on relevant events.

### Step 7 — Knowledge & Notifications (Weeks 13–14)
- `ContentModule`: ContentPiece + ContentLocale models, publication workflow. Locales seeded for `EN` and `TW` only in Phase 0.
- `QAModule`: submission, triage queue, response.
- `NotificationsModule`: **SMS via Hubtel only.** Channel preferences on user record include WhatsApp/email fields but only SMS is wired. WhatsApp delivery added in Phase 1.

### Step 8 — Advisor (Weeks 15–17)
*No subscription billing. No PDF generation. Share = email summary.*
- `IntelligenceModule`: data ingestion workers for Open-Meteo, NASA POWER, MOFA published datasets. Typed query interface (`getYieldDistribution`, `getPriceHistory`).
- `ScenariosModule`: profile capture, default scenario generation, Monte Carlo engine (10,000 iterations). Scenario state persisted; user can return and edit inputs.
- Scenario summary delivered by **HTML email** (via the same SMS-style notifications pattern, but email channel) to a recipient address the user provides. No PDF, no signed share link in Phase 0.
- **No Stripe, no Paystack-for-subscriptions, no paywall logic.** Advisor is free.

### Step 9 — Hardening (Weeks 18–20)
- Performance optimization (query plans, missing indices, N+1 fixes).
- Load testing with k6.
- Penetration test prep.
- Documentation pass.
- Use any remaining buffer for the highest-value Phase 1 prep: PSP integration scaffolding, WhatsApp Business onboarding, lender partnership technical discovery.

---

## 12. Anti-patterns — do not do these

These are mistakes that look reasonable but corrode the codebase. If you find yourself reaching for one, stop and reconsider.

- **Putting business logic in a controller.** Controllers are HTTP adapters. Business logic in `*.service.ts`.
- **Calling Prisma directly from a service or controller.** Repositories own data access.
- **Returning Prisma models from controllers.** Always serialize through a response DTO.
- **Throwing raw `Error` from services.** Use NestJS HTTP exceptions or define a domain exception.
- **Using `Float` for money.** Always `BigInt` in minor units, always via `Money` value object.
- **Hard-coding configuration.** Everything env-driven via ConfigService.
- **Catching exceptions in services to "handle gracefully."** Let them propagate; the global filter handles them.
- **Inventing a new pattern for a problem already solved.** If you see audit-needed, use AuditInterceptor; if you see external-call-needed, use the integrations pattern; if you see async-work-needed, queue a BullMQ job.
- **Adding cross-module dependencies through direct imports.** Modules consume each other via exported services only.
- **Skipping validation "because it's an internal endpoint."** Every endpoint validates. There are no internal endpoints exposed via HTTP.
- **Using `any` to make TypeScript happy.** If `any` is needed, comment why. If you don't have a justification, find the right type.
- **Logging sensitive data.** No GhanaCard numbers, no phone numbers, no tokens, no PII in logs. The logging interceptor scrubs known fields; do not log raw request bodies.
- **Soft-delete-then-recreate.** Restore the existing record instead of creating a duplicate.
- **Skipping migrations and using `db push`.** Every schema change is a migration in source control.

---

## 13. Environment variables

`apps/api/.env.example` documents every required variable. Validate them on startup via Zod or class-validator in `ConfigModule`. The app crashes loudly on a missing required variable, not silently with `undefined`.

Required for Phase 0:
- `DATABASE_URL`, `DIRECT_DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`, `JWT_ACCESS_TTL`, `JWT_REFRESH_TTL`
- `HUBTEL_CLIENT_ID`, `HUBTEL_CLIENT_SECRET`, `HUBTEL_SENDER_ID` (SMS only)
- `NIA_API_KEY`, `NIA_API_URL`
- `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`
- `OPEN_METEO_API_URL`, `NASA_POWER_API_URL`
- `MAPBOX_TOKEN`
- `SENTRY_DSN`
- `PII_ENCRYPTION_KEY` (32 bytes, base64)
- `EMAIL_PROVIDER_API_KEY`, `EMAIL_FROM_ADDRESS` (for Advisor scenario summaries)

**Phase 1+ env vars — do not configure in Phase 0:**
- `SMILE_ID_PARTNER_ID`, `SMILE_ID_API_KEY` (liveness)
- `COMPLY_ADVANTAGE_API_KEY` (sanctions)
- `PAYSTACK_SECRET_KEY`, `FLUTTERWAVE_SECRET_KEY` (card payments)
- `STRIPE_SECRET_KEY` (Advisor subscriptions)
- `WHATSAPP_API_URL`, `WHATSAPP_API_KEY` (WhatsApp Business)
- `HUBTEL_MOMO_*` (MoMo collection/payout)
- `ESCROW_TRUST_ACCOUNT_ID` (bank partner)

Never commit a real value. The example file shows shape, not secrets.

---

## 14. When uncertain

Before writing code that doesn't fit a pattern in this document:

1. Search the codebase for a similar pattern. Reuse before invent.
2. Re-read the relevant section of this document.
3. If still uncertain, ask a clarifying question. Do not invent.

Patterns in this document are non-negotiable for Phase 0. Improving them happens through code review and ADRs, not unilateral departure.
