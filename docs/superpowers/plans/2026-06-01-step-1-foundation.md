# Step 1 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the AgriZone backend foundation — dependencies, Docker services, typed
config, Prisma with a soft-delete extension, the `Money` value object, global error handling
with correlation IDs, structured logging, a real health check, Swagger, Sentry, and CI — so
every later module plugs into established cross-cutting patterns.

**Architecture:** Flat `src/` NestJS 11 modular monolith. `ConfigModule` validates env on
boot. `PrismaService` owns DB access with a client extension that filters `deletedAt: null`.
A global `AllExceptionsFilter` renders `{error:{code,message,correlationId}}`; a correlation-id
middleware stamps every request. Pino logs structured JSON. Health checks DB + Redis.

**Tech stack:** NestJS 11, TypeScript 5.7, Prisma 6, Postgres 16, Redis 7 (ioredis),
`@nestjs/config`, `zod`, `nestjs-pino`, `@nestjs/terminus`, `@nestjs/swagger`,
`@sentry/node`, `nanoid`, Jest + supertest. pnpm.

**Spec:** `docs/superpowers/specs/2026-06-01-agrizone-backend-phase0-design.md` §2, §3, §8.1–8.3.

**Local datastores (this machine):** No Docker. Postgres runs natively (Homebrew Postgres 18,
DB `agrizone_dev`, user `emmanuel`, no password) and Redis runs natively (Homebrew, `:6379`).
`docker-compose.yml` is committed for CI/portability only — it is not run locally. Local
`DATABASE_URL` = `postgresql://emmanuel@localhost:5432/agrizone_dev`; `REDIS_URL` =
`redis://localhost:6379`.

---

## File structure produced by this plan

```
docker-compose.yml                         # postgres 16 + redis 7
.env.example                               # documented required vars
.env                                       # local (gitignored)
prisma/schema.prisma                       # datasource + base enums
src/config/env.schema.ts                   # zod schema for env
src/config/env.validation.ts              # validate() used by ConfigModule
src/config/config.module.ts                # global typed ConfigModule
src/common/services/prisma.service.ts      # PrismaClient + soft-delete extension
src/common/services/prisma.module.ts       # global PrismaModule
src/common/value-objects/money.ts          # Money VO (BigInt pesewas)
src/common/value-objects/money.spec.ts
src/common/errors/error-codes.ts           # ErrorCode enum + AppException
src/common/errors/error-codes.spec.ts
src/common/filters/all-exceptions.filter.ts
src/common/filters/all-exceptions.filter.spec.ts
src/common/middleware/correlation-id.middleware.ts
src/common/middleware/correlation-id.middleware.spec.ts
src/common/common.module.ts                # exports shared providers
src/modules/health/health.module.ts
src/modules/health/health.controller.ts
src/modules/health/health.controller.spec.ts
src/main.ts                                # MODIFY: prefix, pipe, filter, swagger, pino, sentry
src/app.module.ts                          # MODIFY: wire modules
.github/workflows/ci.yml
```

The default scaffold's `src/app.controller.ts`, `src/app.service.ts`, and their spec are
removed in Task 2 (replaced by the health endpoint).

---

## Task 1: Dependencies, scripts, and local port

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: Install runtime dependencies**

Run:
```bash
pnpm add @nestjs/config zod @prisma/client nestjs-pino pino-http pino-pretty \
  @nestjs/terminus @nestjs/axios axios @nestjs/swagger ioredis @sentry/node nanoid
```

- [ ] **Step 2: Install dev dependencies**

Run:
```bash
pnpm add -D prisma
```

- [ ] **Step 3: Add the prisma + dev:db scripts to `package.json`**

In `package.json` `"scripts"`, add:
```json
"db:up": "docker compose up -d",
"db:down": "docker compose down",
"prisma:generate": "prisma generate",
"prisma:migrate": "prisma migrate dev",
"prisma:studio": "prisma studio"
```

- [ ] **Step 4: Confirm `.gitignore` ignores env + prisma artifacts**

Ensure `.gitignore` contains these lines (add any missing):
```
.env
/generated
```

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml .gitignore
git commit -m "chore: add foundation dependencies and db scripts"
```

---

## Task 2: Docker services + remove default scaffold endpoint

**Files:**
- Create: `docker-compose.yml`
- Delete: `src/app.controller.ts`, `src/app.service.ts`, `src/app.controller.spec.ts`

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    environment:
      POSTGRES_USER: agrizone
      POSTGRES_PASSWORD: agrizone
      POSTGRES_DB: agrizone
    ports:
      - "5432:5432"
    volumes:
      - agrizone_pg:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U agrizone"]
      interval: 5s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - agrizone_redis:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 5

volumes:
  agrizone_pg:
  agrizone_redis:
```

- [ ] **Step 2: Verify local datastores are reachable**

This machine has no Docker; local dev uses **native Postgres + Redis** that are already running
(Homebrew Postgres 18 on `:5432`, Redis on `:6379`). `docker-compose.yml` is committed only for
CI parity and contributors who do have Docker — **do not** run it here.

Run:
```bash
redis-cli ping
psql -d agrizone_dev -tAc "select 1"
```
Expected: `PONG` and `1`. (DB `agrizone_dev` was created during setup via `createdb agrizone_dev`.)

- [ ] **Step 3: Delete the scaffold endpoint files**

```bash
git rm src/app.controller.ts src/app.service.ts src/app.controller.spec.ts
```

These are replaced by the health endpoint (Task 8). `app.module.ts` is rewired in Task 9.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "chore: add postgres+redis docker-compose, drop scaffold hello endpoint"
```

---

## Task 3: Typed, validated config

**Files:**
- Create: `.env.example`, `.env`
- Create: `src/config/env.schema.ts`, `src/config/env.validation.ts`, `src/config/config.module.ts`

- [ ] **Step 1: Write the failing test for env validation**

Create `src/config/env.validation.spec.ts`:
```typescript
import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const base = {
    NODE_ENV: 'test',
    PORT: '3001',
    DATABASE_URL: 'postgresql://agrizone:agrizone@localhost:5432/agrizone',
    REDIS_URL: 'redis://localhost:6379',
  };

  it('passes with valid env and coerces PORT to a number', () => {
    const parsed = validateEnv(base);
    expect(parsed.PORT).toBe(3001);
    expect(parsed.NODE_ENV).toBe('test');
  });

  it('throws when a required var is missing', () => {
    const { DATABASE_URL: _omit, ...rest } = base;
    expect(() => validateEnv(rest)).toThrow(/DATABASE_URL/);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm jest src/config/env.validation.spec.ts`
Expected: FAIL — cannot find module `./env.validation`.

- [ ] **Step 3: Write the env schema**

Create `src/config/env.schema.ts`:
```typescript
import { z } from 'zod';

// Phase 0 required vars (spec §11). Optional integration vars are added by the
// modules that consume them; foundation only needs core infra + observability.
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  SENTRY_DSN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;
```

- [ ] **Step 4: Write the validate function**

Create `src/config/env.validation.ts`:
```typescript
import { envSchema, type Env } from './env.schema';

// Used as ConfigModule's `validate`. Throws loudly (crash on boot) on bad env.
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid environment: ${issues}`);
  }
  return result.data;
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `pnpm jest src/config/env.validation.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Write the global ConfigModule**

Create `src/config/config.module.ts`:
```typescript
import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnv } from './env.validation';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
  ],
})
export class ConfigModule {}
```

- [ ] **Step 7: Write `.env.example` and `.env`**

Create `.env.example`:
```bash
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://agrizone:agrizone@localhost:5432/agrizone
REDIS_URL=redis://localhost:6379
# Observability (optional in dev)
SENTRY_DSN=
```

`.env.example` documents the portable (docker-compose) defaults. For **this machine's native
datastores**, write `.env` with the local connection instead of copying:
```bash
cat > .env <<'EOF'
NODE_ENV=development
PORT=3001
DATABASE_URL=postgresql://emmanuel@localhost:5432/agrizone_dev
REDIS_URL=redis://localhost:6379
SENTRY_DSN=
EOF
```

- [ ] **Step 8: Commit**

```bash
git add src/config .env.example
git commit -m "feat: typed env validation and global ConfigModule"
```

---

## Task 4: Prisma datasource, base enums, and the soft-delete-ready service

**Files:**
- Create: `prisma/schema.prisma`
- Create: `src/common/services/prisma.service.ts`, `src/common/services/prisma.module.ts`

- [ ] **Step 1: Write `prisma/schema.prisma` with the datasource and shared enums**

Spec §7 enums; no domain models yet (added per-module later).
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Locale {
  EN
  TW
  EE
  DA
}

enum VerificationTier {
  T0
  T1
  T2
  T3
  T4
}

enum UserStatus {
  ACTIVE
  SUSPENDED
  BANNED
}

enum Currency {
  GHS
  USD
  GBP
  EUR
}
```

- [ ] **Step 2: Create the first migration**

Run: `pnpm prisma migrate dev --name init_enums`
Expected: migration created under `prisma/migrations/`, client generated, no errors.

- [ ] **Step 3: Write the PrismaService with the soft-delete extension**

Create `src/common/services/prisma.service.ts`:
```typescript
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Models that carry a nullable `deletedAt`. Reads on these auto-filter to
// deletedAt: null unless a query explicitly passes deletedAt. Append-only tables
// (LedgerEntry, AuditLog) are NOT listed here. Models are added as later steps
// introduce them.
const SOFT_DELETE_MODELS = new Set<string>([]);

function softDeleteExtension(client: PrismaClient) {
  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          const isRead = operation === 'findFirst' || operation === 'findMany' || operation === 'findUnique';
          if (model && SOFT_DELETE_MODELS.has(model) && isRead) {
            const a = (args ?? {}) as { where?: Record<string, unknown> };
            if (!a.where || !('deletedAt' in a.where)) {
              a.where = { ...(a.where ?? {}), deletedAt: null };
            }
            return query(a);
          }
          return query(args);
        },
      },
    },
  });
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  /** The soft-delete-extended client. Repositories use this. */
  readonly db: ReturnType<typeof softDeleteExtension>;

  constructor() {
    super();
    this.db = softDeleteExtension(this);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

- [ ] **Step 4: Write the global PrismaModule**

Create `src/common/services/prisma.module.ts`:
```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 5: Smoke-test the connection**

Create `src/common/services/prisma.service.spec.ts`:
```typescript
import { PrismaService } from './prisma.service';

describe('PrismaService', () => {
  it('connects and runs a trivial query', async () => {
    const prisma = new PrismaService();
    await prisma.onModuleInit();
    const rows = await prisma.$queryRawUnsafe<Array<{ ok: number }>>('SELECT 1 as ok');
    expect(rows[0].ok).toBe(1);
    await prisma.onModuleDestroy();
  });
});
```

- [ ] **Step 6: Run it (requires local Postgres running)**

Run: `pnpm jest src/common/services/prisma.service.spec.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add prisma src/common/services
git commit -m "feat: prisma datasource, base enums, soft-delete-ready PrismaService"
```

---

## Task 5: The `Money` value object

**Files:**
- Create: `src/common/value-objects/money.ts`, `src/common/value-objects/money.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/common/value-objects/money.spec.ts`:
```typescript
import { Money } from './money';

describe('Money', () => {
  it('constructs from major GHS units into minor (pesewas)', () => {
    expect(Money.fromMajor(350).minor).toBe(35000n);
  });

  it('constructs from minor units', () => {
    expect(Money.fromMinor(35000n).minor).toBe(35000n);
  });

  it('adds and multiplies without floats', () => {
    const unit = Money.fromMajor(345);
    expect(unit.times(8).minor).toBe(276000n);
    expect(unit.plus(Money.fromMajor(5)).minor).toBe(35000n);
  });

  it('takes basis-point fractions (commission) with floor rounding', () => {
    // 1.5% of GHS 2760.00 = GHS 41.40 -> 4140 pesewas
    expect(Money.fromMinor(276000n).bps(150).minor).toBe(4140n);
  });

  it('serializes minor units to string and formats major', () => {
    const m = Money.fromMinor(401880n);
    expect(m.toMinorString()).toBe('401880');
    expect(m.toMajorString()).toBe('4018.80');
  });
});
```

- [ ] **Step 2: Run it red**

Run: `pnpm jest src/common/value-objects/money.spec.ts`
Expected: FAIL — cannot find module `./money`.

- [ ] **Step 3: Implement `Money`**

Create `src/common/value-objects/money.ts`:
```typescript
// All money is BigInt minor units (pesewas; GHS * 100). Never Float. All money
// arithmetic in the codebase goes through this value object (spec §3.4).
export class Money {
  private constructor(readonly minor: bigint) {}

  static fromMinor(minor: bigint): Money {
    return new Money(minor);
  }

  /** major GHS (e.g. 350.5) -> minor (35050). Rounds to nearest pesewa. */
  static fromMajor(major: number): Money {
    return new Money(BigInt(Math.round(major * 100)));
  }

  plus(other: Money): Money {
    return new Money(this.minor + other.minor);
  }

  minus(other: Money): Money {
    return new Money(this.minor - other.minor);
  }

  /** Multiply by an integer count (e.g. price per bag * bags). */
  times(count: number): Money {
    if (!Number.isInteger(count)) {
      throw new Error('Money.times expects an integer count');
    }
    return new Money(this.minor * BigInt(count));
  }

  /** Take a basis-point fraction (150 bps = 1.5%), floor-rounded. */
  bps(basisPoints: number): Money {
    return new Money((this.minor * BigInt(basisPoints)) / 10000n);
  }

  toMinorString(): string {
    return this.minor.toString();
  }

  toMajorString(): string {
    const neg = this.minor < 0n;
    const abs = neg ? -this.minor : this.minor;
    const whole = abs / 100n;
    const frac = (abs % 100n).toString().padStart(2, '0');
    return `${neg ? '-' : ''}${whole}.${frac}`;
  }
}
```

- [ ] **Step 4: Run it green**

Run: `pnpm jest src/common/value-objects/money.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/common/value-objects
git commit -m "feat: Money value object (BigInt pesewas)"
```

---

## Task 6: Error codes + structured exception filter

**Files:**
- Create: `src/common/errors/error-codes.ts`, `src/common/errors/error-codes.spec.ts`
- Create: `src/common/filters/all-exceptions.filter.ts`, `src/common/filters/all-exceptions.filter.spec.ts`

- [ ] **Step 1: Write the failing test for `AppException`**

Create `src/common/errors/error-codes.spec.ts`:
```typescript
import { HttpStatus } from '@nestjs/common';
import { AppException, ErrorCode } from './error-codes';

describe('AppException', () => {
  it('carries a stable code and http status', () => {
    const ex = new AppException(ErrorCode.LISTING_NOT_FOUND, 'Listing not found', HttpStatus.NOT_FOUND);
    expect(ex.code).toBe('LISTING_NOT_FOUND');
    expect(ex.getStatus()).toBe(404);
    expect(ex.message).toBe('Listing not found');
  });
});
```

- [ ] **Step 2: Run it red**

Run: `pnpm jest src/common/errors/error-codes.spec.ts`
Expected: FAIL — cannot find module `./error-codes`.

- [ ] **Step 3: Implement error codes + `AppException`**

Create `src/common/errors/error-codes.ts`:
```typescript
import { HttpException, HttpStatus } from '@nestjs/common';

// Stable codes the frontend branches on (spec §3.5). Grows as modules are added.
export enum ErrorCode {
  INTERNAL = 'INTERNAL',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  TIER_TOO_LOW = 'TIER_TOO_LOW',
  LISTING_NOT_FOUND = 'LISTING_NOT_FOUND',
}

export class AppException extends HttpException {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string, status: HttpStatus = HttpStatus.BAD_REQUEST) {
    super(message, status);
    this.code = code;
  }
}
```

- [ ] **Step 4: Run it green**

Run: `pnpm jest src/common/errors/error-codes.spec.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the filter**

Create `src/common/filters/all-exceptions.filter.spec.ts`:
```typescript
import { ArgumentsHost, HttpStatus, NotFoundException } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { AppException, ErrorCode } from '../errors/error-codes';

function mockHost(): { host: ArgumentsHost; payload: () => unknown; status: () => number } {
  let body: unknown;
  let code = 0;
  const res = {
    status(s: number) { code = s; return this; },
    json(b: unknown) { body = b; return this; },
  };
  const req = { correlationId: 'CID-123', url: '/v1/x', method: 'GET' };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => req }),
  } as unknown as ArgumentsHost;
  return { host, payload: () => body, status: () => code };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('renders AppException with its code and the correlation id', () => {
    const m = mockHost();
    filter.catch(new AppException(ErrorCode.LISTING_NOT_FOUND, 'Listing not found', HttpStatus.NOT_FOUND), m.host);
    expect(m.status()).toBe(404);
    expect(m.payload()).toEqual({
      error: { code: 'LISTING_NOT_FOUND', message: 'Listing not found', correlationId: 'CID-123' },
    });
  });

  it('maps a built-in NotFoundException to NOT_FOUND code', () => {
    const m = mockHost();
    filter.catch(new NotFoundException('nope'), m.host);
    expect(m.status()).toBe(404);
    expect((m.payload() as { error: { code: string } }).error.code).toBe('NOT_FOUND');
  });

  it('renders unknown errors as INTERNAL 500', () => {
    const m = mockHost();
    filter.catch(new Error('boom'), m.host);
    expect(m.status()).toBe(500);
    expect((m.payload() as { error: { code: string } }).error.code).toBe('INTERNAL');
  });
});
```

- [ ] **Step 6: Run it red**

Run: `pnpm jest src/common/filters/all-exceptions.filter.spec.ts`
Expected: FAIL — cannot find module `./all-exceptions.filter`.

- [ ] **Step 7: Implement the filter**

Create `src/common/filters/all-exceptions.filter.ts`:
```typescript
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AppException, ErrorCode } from '../errors/error-codes';

interface RequestWithCorrelation {
  correlationId?: string;
  url?: string;
  method?: string;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<{ status: (n: number) => { json: (b: unknown) => unknown } }>();
    const req = http.getRequest<RequestWithCorrelation>();
    const correlationId = req.correlationId ?? 'unknown';

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string = ErrorCode.INTERNAL;
    let message = 'Internal server error';

    if (exception instanceof AppException) {
      status = exception.getStatus();
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = HttpStatus[status] ?? ErrorCode.INTERNAL; // e.g. NOT_FOUND
      const r = exception.getResponse();
      message = typeof r === 'string' ? r : ((r as { message?: string }).message ?? exception.message);
    }

    res.status(status).json({ error: { code, message, correlationId } });
  }
}
```

- [ ] **Step 8: Run it green**

Run: `pnpm jest src/common/filters/all-exceptions.filter.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add src/common/errors src/common/filters
git commit -m "feat: structured error codes and global exception filter"
```

---

## Task 7: Correlation-id middleware

**Files:**
- Create: `src/common/middleware/correlation-id.middleware.ts`, `src/common/middleware/correlation-id.middleware.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/common/middleware/correlation-id.middleware.spec.ts`:
```typescript
import { CorrelationIdMiddleware } from './correlation-id.middleware';

describe('CorrelationIdMiddleware', () => {
  const mw = new CorrelationIdMiddleware();

  it('reuses an inbound x-correlation-id header', () => {
    const req = { headers: { 'x-correlation-id': 'CID-in' } } as never as { correlationId?: string };
    const setHeader = jest.fn();
    const next = jest.fn();
    mw.use(req as never, { setHeader } as never, next);
    expect((req as { correlationId?: string }).correlationId).toBe('CID-in');
    expect(setHeader).toHaveBeenCalledWith('x-correlation-id', 'CID-in');
    expect(next).toHaveBeenCalled();
  });

  it('generates one when absent', () => {
    const req = { headers: {} } as never as { correlationId?: string };
    const next = jest.fn();
    mw.use(req as never, { setHeader: jest.fn() } as never, next);
    expect((req as { correlationId?: string }).correlationId).toMatch(/.{10,}/);
    expect(next).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it red**

Run: `pnpm jest src/common/middleware/correlation-id.middleware.spec.ts`
Expected: FAIL — cannot find module.

- [ ] **Step 3: Implement the middleware**

Create `src/common/middleware/correlation-id.middleware.ts`. (Uses `node:crypto`'s
`randomUUID` rather than `nanoid` — the installed `nanoid` v5 is ESM-only and would break the
CommonJS build; `randomUUID` is built-in and dependency-free.)
```typescript
import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

interface Req { headers: Record<string, string | string[] | undefined>; correlationId?: string }
interface Res { setHeader: (k: string, v: string) => void }

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Req, res: Res, next: () => void): void {
    const inbound = req.headers['x-correlation-id'];
    const id = (typeof inbound === 'string' && inbound) || randomUUID();
    req.correlationId = id;
    res.setHeader('x-correlation-id', id);
    next();
  }
}
```

- [ ] **Step 4: Run it green**

Run: `pnpm jest src/common/middleware/correlation-id.middleware.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/common/middleware
git commit -m "feat: correlation-id middleware"
```

---

## Task 8: Health module (real DB + Redis checks)

**Files:**
- Create: `src/modules/health/health.module.ts`, `src/modules/health/health.controller.ts`, `src/modules/health/health.controller.spec.ts`

- [ ] **Step 1: Write the failing controller test**

We use **custom indicator functions** (Prisma + ioredis), not `TypeOrmHealthIndicator` (there
is no TypeORM). The `HealthCheckService` mock actually invokes the indicator fns so a broken
indicator fails the test.

Create `src/modules/health/health.controller.spec.ts`:
```typescript
import { Test } from '@nestjs/testing';
import { HealthCheckService } from '@nestjs/terminus';
import { ConfigService } from '@nestjs/config';
import { HealthController } from './health.controller';
import { PrismaService } from '../../common/services/prisma.service';

describe('HealthController', () => {
  it('aggregates db + redis indicators to ok', async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        {
          provide: HealthCheckService,
          useValue: {
            check: async (fns: Array<() => Promise<unknown>>) => {
              await Promise.all(fns.map((f) => f()));
              return { status: 'ok', info: {}, error: {}, details: {} };
            },
          },
        },
        { provide: PrismaService, useValue: { $queryRawUnsafe: jest.fn().mockResolvedValue([{ '?column?': 1 }]) } },
        { provide: ConfigService, useValue: { get: () => 'redis://localhost:6379' } },
      ],
    }).compile();

    const controller = moduleRef.get(HealthController);
    const result = await controller.check();
    expect(result.status).toBe('ok');
  });
});
```

> The redis indicator connects to local Redis in this test; ensure Redis is running (`redis-cli ping`).
> CI (Task 11) provisions Redis as a service.

- [ ] **Step 2: Run it red**

Run: `pnpm jest src/modules/health/health.controller.spec.ts`
Expected: FAIL — cannot find module `./health.controller`.

- [ ] **Step 3: Implement the health controller with custom indicators**

Create `src/modules/health/health.controller.ts`:
```typescript
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService, HealthCheckResult, HealthIndicatorResult } from '@nestjs/terminus';
import { ApiTags } from '@nestjs/swagger';
import Redis from 'ioredis';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/services/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @HealthCheck()
  async check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.checkDb(),
      () => this.checkRedis(),
    ]);
  }

  private async checkDb(): Promise<HealthIndicatorResult> {
    await this.prisma.$queryRawUnsafe('SELECT 1');
    return { database: { status: 'up' } };
  }

  private async checkRedis(): Promise<HealthIndicatorResult> {
    const url = this.config.get<string>('REDIS_URL');
    const client = new Redis(url!, { lazyConnect: true, maxRetriesPerRequest: 1 });
    try {
      await client.connect();
      await client.ping();
      return { redis: { status: 'up' } };
    } finally {
      client.disconnect();
    }
  }
}
```

- [ ] **Step 4: Implement the health module**

Create `src/modules/health/health.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
})
export class HealthModule {}
```

- [ ] **Step 5: Run the test green**

Run: `pnpm jest src/modules/health/health.controller.spec.ts`
Expected: PASS (the test from Step 1 now resolves the controller + module).

- [ ] **Step 6: Commit**

```bash
git add src/modules/health
git commit -m "feat: health endpoint with db+redis checks"
```

---

## Task 9: Wire it together — app module, main bootstrap, logging, Swagger, Sentry

**Files:**
- Create: `src/common/common.module.ts`
- Modify: `src/app.module.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Create the CommonModule that applies the correlation-id middleware globally**

Create `src/common/common.module.ts`:
```typescript
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CorrelationIdMiddleware } from './middleware/correlation-id.middleware';

@Module({})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
```

- [ ] **Step 2: Rewrite `src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './common/services/prisma.module';
import { CommonModule } from './common/common.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
        // never log known sensitive fields (spec §3 anti-pattern)
        redact: ['req.headers.authorization', 'req.headers.cookie'],
        customProps: (req: { correlationId?: string }) => ({ correlationId: req.correlationId }),
      },
    }),
    PrismaModule,
    CommonModule,
    HealthModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 3: Rewrite `src/main.ts`**

```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import * as Sentry from '@sentry/node';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.setGlobalPrefix('v1');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const dsn = process.env.SENTRY_DSN;
  if (dsn) {
    Sentry.init({ dsn, environment: process.env.NODE_ENV });
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('AgriZone API')
    .setDescription('Phase 0')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const doc = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('v1/docs', app, doc);

  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
```

- [ ] **Step 4: Build to verify everything compiles**

Run: `pnpm build`
Expected: success, `dist/` produced, no TS errors.

- [ ] **Step 5: Boot and hit health + docs (manual smoke)**

Run (in one shell, with local Postgres + Redis running): `pnpm start` then in another shell:
```bash
curl -s http://localhost:3001/v1/health
```
Expected: JSON containing `"status":"ok"`. Visit `http://localhost:3001/v1/docs` → Swagger UI.

- [ ] **Step 6: Run the full unit suite**

Run: `pnpm test`
Expected: all specs PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app.module.ts src/main.ts src/common/common.module.ts
git commit -m "feat: wire app module, global prefix/pipe/filter, pino, swagger, sentry"
```

---

## Task 10: End-to-end health test

**Files:**
- Modify: `test/app.e2e-spec.ts`
- Modify: `test/jest-e2e.json` (only if needed)

- [ ] **Step 1: Replace the default e2e test**

Replace `test/app.e2e-spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /v1/health -> 200 ok', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
  });
});
```

- [ ] **Step 2: Run the e2e suite (requires local Postgres + Redis)**

Run: `pnpm test:e2e`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add test/app.e2e-spec.ts
git commit -m "test: e2e health check"
```

---

## Task 11: CI pipeline

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Write the CI workflow**

Create `.github/workflows/ci.yml`:
```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: agrizone
          POSTGRES_PASSWORD: agrizone
          POSTGRES_DB: agrizone
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U agrizone" --health-interval 5s
          --health-timeout 5s --health-retries 5
      redis:
        image: redis:7
        ports: ['6379:6379']
        options: >-
          --health-cmd "redis-cli ping" --health-interval 5s
          --health-timeout 5s --health-retries 5
    env:
      DATABASE_URL: postgresql://agrizone:agrizone@localhost:5432/agrizone
      REDIS_URL: redis://localhost:6379
      NODE_ENV: test
      PORT: '3001'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm prisma migrate deploy
      - run: pnpm prisma generate
      - run: pnpm lint
      - run: pnpm build
      - run: pnpm test
      - run: pnpm test:e2e
```

- [ ] **Step 2: Verify the same commands pass locally**

Run, in order (with local Postgres + Redis running):
```bash
pnpm prisma migrate deploy && pnpm lint && pnpm build && pnpm test && pnpm test:e2e
```
Expected: all succeed.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: lint, build, unit, e2e with postgres+redis services"
```

---

## Done-when (Step 1 acceptance)

- Local Postgres (`agrizone_dev`) + Redis are reachable (`psql -d agrizone_dev`/`redis-cli ping`).
- App boots on `:3001`; `GET /v1/health` returns `{status:"ok"}` (db + redis up); `/v1/docs`
  serves Swagger.
- Missing required env crashes boot with a clear message.
- `Money`, `AllExceptionsFilter`, `CorrelationIdMiddleware`, and config validation are unit-
  tested green; health is covered by unit + e2e.
- CI is green on lint, build, unit, and e2e.

## Hand-off to Step 2

Step 2 (Identity) adds the `User`/`UserRole` models to `prisma/schema.prisma`, registers them
in `SOFT_DELETE_MODELS`, and builds Auth (OTP/JWT), the guards/decorators, and Audit. It also
stands up a minimal `notifications` BullMQ queue + `HubtelService` for OTP SMS. The error-code
enum gains `OTP_INVALID`, `OTP_EXPIRED`, `USER_NOT_FOUND`, etc.
