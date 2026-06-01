# Step 2 — Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the identity layer — Users + roles, phone-OTP authentication with JWT access +
rotating refresh tokens, the role/tier authorization guards & decorators, automatic audit
logging, and a minimal Hubtel SMS queue to deliver OTP codes — so every later module can
authenticate, authorize, and audit.

**Architecture:** Phone-OTP sign-in: `request-otp` finds-or-creates a `User` (T0) and queues an
SMS with a 6-digit code (HMAC-hashed in Redis, 5-min TTL); `verify-otp` checks it, promotes
T0→T1, and issues an access JWT (15 min) + a rotating refresh token (30 d, hashed in Redis),
both as HttpOnly cookies and in the body. Authorization is via `@RequireRole`/`@RequireTier`
decorators read by `RolesGuard`/`TierGuard`. A global `AuditInterceptor` records every mutation
to an append-only `AuditLog`. PII (GhanaCard number, legal name) is AES-256-GCM encrypted at
the application layer.

**Tech stack:** NestJS 11, Prisma 6, Postgres, Redis (ioredis), `@nestjs/jwt`,
`@nestjs/passport` + `passport-jwt`, `@nestjs/bullmq` + `bullmq`, `cookie-parser`,
`node:crypto` (HMAC for OTP/refresh hashing, AES-256-GCM for PII — no native hashing deps).
Jest + supertest.

**Spec:** `docs/superpowers/specs/2026-06-01-agrizone-backend-phase0-design.md` §3.1–3.3, §6,
§8.4–8.6. Builds on Step 1 (merged to `main`).

> **Execution order note:** Task 11 (Audit module) must be built **before** Task 10 (Auth
> service/wiring), because `AuthService` imports `AuditService`. Run tasks in this order:
> 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → **11 → 10** → 12.

**Local datastores:** native Homebrew Postgres (`agrizone_dev`) + Redis (`:6379`), no Docker
(same as Step 1). API on `:3001`.

---

## Design decisions (read before implementing)

- **No native hashing deps.** OTP codes and refresh tokens are hashed with **HMAC-SHA256**
  (`node:crypto`), keyed by `JWT_SECRET`. We do NOT add bcrypt/argon2 (Phase 0 has no
  passwords, and native modules complicate pnpm 10 builds).
- **PII encryption** uses **AES-256-GCM** (`node:crypto`) with `PII_ENCRYPTION_KEY` (32 bytes,
  base64). Stored as `base64(iv | authTag | ciphertext)`.
- **Tokens:** access JWT carries `sub` (userId), `roles`, `tier`. Refresh tokens are random
  32-byte hex; only their HMAC is stored in Redis at `refresh:<userId>:<jti>` (TTL = refresh
  TTL); refresh **rotates** (old deleted, new issued). Tokens are set as HttpOnly cookies
  (`az_access`, `az_refresh`) **and** returned in the response body (so the UI's cookie flow
  and API clients both work; tests read the body).
- **Dev OTP affordance:** `POST /v1/auth/request-otp` includes the plaintext `debugCode` in its
  response **only when `NODE_ENV !== 'production'`**. This lets e2e/tests and local UI complete
  the flow without a real SMS gateway. Never present in production.
- **Tier promotion:** first successful `verify-otp` promotes `T0 → T1` (phone confirmed),
  writes an audit record, and emits `verification.tier-changed`. The `VerificationEvent` model +
  `VerificationModule` persistence arrive in Step 3; emitting now with no DB subscriber is fine.
- **Hubtel in dev:** `HubtelService.sendSms` performs a real HTTP POST only when
  `HUBTEL_CLIENT_ID/SECRET/SENDER_ID` are set; otherwise it **logs** the SMS (dev stub). The
  circuit breaker (`opossum`) is deferred to Step 7 when NotificationsModule is completed.

---

## File structure produced by this plan

```
prisma/schema.prisma                         # MODIFY: + User, UserRole, AuditLog, Role enum
prisma/migrations/<ts>_identity/             # new migration
src/common/services/prisma.service.ts        # MODIFY: register User, UserRole in SOFT_DELETE_MODELS
src/common/errors/error-codes.ts             # MODIFY: + OTP_*, USER_NOT_FOUND, REFRESH_INVALID, PHONE_INVALID
src/config/env.schema.ts                     # MODIFY: + JWT_*, PII_ENCRYPTION_KEY, HUBTEL_*, OTP_*
src/common/crypto/pii-cipher.ts(+spec)       # AES-256-GCM PII encrypt/decrypt
src/common/crypto/hmac.ts(+spec)             # HMAC-SHA256 helper for OTP/refresh hashing
src/common/redis/redis.module.ts             # global shared ioredis provider
src/common/redis/redis.service.ts
src/common/types/authenticated-user.ts       # AuthenticatedUser interface
src/common/auth/tier.ts(+spec)               # tier ordinal rank + compare
src/common/decorators/current-user.decorator.ts
src/common/decorators/require-role.decorator.ts
src/common/decorators/require-tier.decorator.ts
src/common/guards/jwt-auth.guard.ts
src/common/guards/roles.guard.ts(+spec)
src/common/guards/tier.guard.ts(+spec)
src/integrations/hubtel/hubtel.service.ts    # dev-stub SMS sender
src/integrations/hubtel/hubtel.module.ts
src/modules/notifications/notifications.module.ts   # BullMQ 'notifications' queue + processor
src/modules/notifications/notifications.processor.ts
src/modules/notifications/notifications.service.ts  # enqueue send-sms
src/workers/queue-names.ts                   # QUEUES constant
src/modules/audit/audit.service.ts
src/modules/audit/audit.repository.ts
src/modules/audit/audit.interceptor.ts
src/modules/audit/audit.module.ts
src/modules/users/users.repository.ts
src/modules/users/users.service.ts
src/modules/users/users.controller.ts
src/modules/users/dto/*.ts
src/modules/users/users.module.ts
src/modules/auth/otp.service.ts(+spec)
src/modules/auth/token.service.ts
src/modules/auth/jwt.strategy.ts
src/modules/auth/auth.service.ts
src/modules/auth/auth.controller.ts
src/modules/auth/dto/*.ts
src/modules/auth/events/tier-changed.event.ts
src/modules/auth/auth.module.ts
src/app.module.ts                            # MODIFY: register new modules + global AuditInterceptor
src/main.ts                                  # MODIFY: cookie-parser
test/auth.e2e-spec.ts                        # OTP sign-up -> T1 -> /me
```

---

## Task 1: Dependencies, env vars, error codes

**Files:** `package.json`, `src/config/env.schema.ts`, `.env`, `.env.example`,
`src/common/errors/error-codes.ts`.

- [ ] **Step 1: Install dependencies**

```bash
pnpm add @nestjs/jwt @nestjs/passport passport passport-jwt @nestjs/bullmq bullmq cookie-parser @nestjs/event-emitter
pnpm add -D @types/passport-jwt @types/cookie-parser
```

- [ ] **Step 2: Drop the now-unused `nanoid` dependency** (carry-in from Step 1 review — the correlation-id middleware uses `node:crypto`)

```bash
pnpm remove nanoid
```

- [ ] **Step 3: Extend the env schema** — edit `src/config/env.schema.ts`, adding these keys to the `z.object({...})` (keep the existing keys):

```typescript
  JWT_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  REFRESH_TTL_SECONDS: z.coerce.number().int().positive().default(2592000), // 30d
  PII_ENCRYPTION_KEY: z.string().min(1), // base64 of 32 bytes
  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  HUBTEL_CLIENT_ID: z.string().optional(),
  HUBTEL_CLIENT_SECRET: z.string().optional(),
  HUBTEL_SENDER_ID: z.string().optional(),
```

- [ ] **Step 4: Add the new vars to `.env`** (local) and `.env.example` (shape only). Generate a real PII key for `.env`:

```bash
KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
cat >> .env <<EOF
JWT_SECRET=dev-only-secret-change-me-32chars-min
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d
REFRESH_TTL_SECONDS=2592000
PII_ENCRYPTION_KEY=$KEY
OTP_TTL_SECONDS=300
OTP_LENGTH=6
OTP_MAX_ATTEMPTS=5
EOF
```
Append the shape to `.env.example` (no real values; leave `HUBTEL_*` blank, document `PII_ENCRYPTION_KEY` as "base64 of 32 random bytes"):
```bash
cat >> .env.example <<'EOF'
JWT_SECRET=
JWT_ACCESS_TTL=15m
JWT_REFRESH_TTL=30d
REFRESH_TTL_SECONDS=2592000
PII_ENCRYPTION_KEY=
OTP_TTL_SECONDS=300
OTP_LENGTH=6
OTP_MAX_ATTEMPTS=5
HUBTEL_CLIENT_ID=
HUBTEL_CLIENT_SECRET=
HUBTEL_SENDER_ID=
EOF
```

- [ ] **Step 5: Add error codes** — edit `src/common/errors/error-codes.ts`, adding to the `ErrorCode` enum (keep existing):
```typescript
  OTP_INVALID = 'OTP_INVALID',
  OTP_EXPIRED = 'OTP_EXPIRED',
  OTP_THROTTLED = 'OTP_THROTTLED',
  USER_NOT_FOUND = 'USER_NOT_FOUND',
  REFRESH_INVALID = 'REFRESH_INVALID',
  PHONE_INVALID = 'PHONE_INVALID',
```

- [ ] **Step 6: Verify install + env validate + commit**

```bash
pnpm jest src/config/env.validation.spec.ts   # still green
git add package.json pnpm-lock.yaml src/config/env.schema.ts src/common/errors/error-codes.ts .env.example
git commit -m "chore: identity deps, env vars, and error codes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```
(Confirm `.env` is NOT staged — it's gitignored.)

---

## Task 2: Schema — User, UserRole, AuditLog + soft-delete registration

**Files:** `prisma/schema.prisma`, `src/common/services/prisma.service.ts`,
`src/common/services/prisma.service.spec.ts`.

- [ ] **Step 1: Add models + Role enum to `prisma/schema.prisma`** (append after the existing enums):

```prisma
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

model User {
  id                       String           @id @default(cuid())
  phone                    String           @unique
  email                    String?          @unique
  displayName              String
  orgName                  String?
  preferredLocale          Locale           @default(EN)
  defaultRegionCode        String?
  verificationTier         VerificationTier @default(T0)
  status                   UserStatus       @default(ACTIVE)
  encryptedGhanaCardNumber String?
  encryptedFullName        String?
  roles                    UserRole[]
  createdAt                DateTime         @default(now())
  updatedAt                DateTime         @updatedAt
  deletedAt                DateTime?

  @@index([phone])
  @@index([verificationTier])
}

model UserRole {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  role      Role
  createdAt DateTime @default(now())

  @@unique([userId, role])
}

model AuditLog {
  id            String   @id @default(cuid())
  actorUserId   String?
  action        String
  entityType    String
  entityId      String?
  ip            String?
  userAgent     String?
  correlationId String?
  before        Json?
  after         Json?
  createdAt     DateTime @default(now())

  @@index([actorUserId])
  @@index([entityType, entityId])
}
```

- [ ] **Step 2: Create the migration**

```bash
pnpm prisma migrate dev --name identity
```
Expected: migration created + applied to `agrizone_dev`, client regenerated. (Now real models exist, so `User`/`UserRole`/`AuditLog` tables are created.)

- [ ] **Step 3: Register the soft-deleted models** — edit `src/common/services/prisma.service.ts`, changing the empty set:
```typescript
const SOFT_DELETE_MODELS = new Set<string>(['User', 'UserRole']);
```
(`AuditLog` is append-only — NOT listed.)

- [ ] **Step 4: Add a real soft-delete-extension test** (carry-in from Step 1 review) — replace `src/common/services/prisma.service.spec.ts` with:

```typescript
import { PrismaService } from './prisma.service';

describe('PrismaService soft-delete extension', () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = new PrismaService();
    await prisma.onModuleInit();
  });

  afterAll(async () => {
    // clean up any test users then disconnect
    await prisma.user.deleteMany({ where: { phone: { startsWith: '+233-test-' } } });
    await prisma.onModuleDestroy();
  });

  it('connects and runs a trivial query', async () => {
    const rows = await prisma.$queryRawUnsafe<Array<{ ok: number }>>('SELECT 1 as ok');
    expect(rows[0].ok).toBe(1);
  });

  it('hides soft-deleted User rows from db.user reads but base client still sees them', async () => {
    const phone = `+233-test-${Date.now()}`;
    const user = await prisma.user.create({ data: { phone, displayName: 'Soft Delete Test' } });

    // soft delete
    await prisma.user.update({ where: { id: user.id }, data: { deletedAt: new Date() } });

    // extended client filters it out
    const viaDb = await prisma.db.user.findFirst({ where: { id: user.id } });
    expect(viaDb).toBeNull();

    // base client still sees it (opt-out path)
    const viaBase = await prisma.user.findFirst({ where: { id: user.id } });
    expect(viaBase?.id).toBe(user.id);

    // explicit deletedAt filter is respected by the extension
    const explicit = await prisma.db.user.findFirst({ where: { id: user.id, deletedAt: { not: null } } });
    expect(explicit?.id).toBe(user.id);
  });
});
```

- [ ] **Step 5: Run it (needs local Postgres)** + tsc

```bash
pnpm jest src/common/services/prisma.service.spec.ts
pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -v 'app.module' || echo "tsc clean"
```
Expected: tests PASS; no NEW tsc errors. (With real models, the soft-delete extension is now exercised. The earlier `as any` in the extension may still be present — leave it; it remains valid.)

- [ ] **Step 6: Commit**
```bash
git add prisma src/common/services
git commit -m "feat: User, UserRole, AuditLog models + soft-delete registration & test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: PII cipher (AES-256-GCM) — TDD

**Files:** `src/common/crypto/pii-cipher.ts`, `src/common/crypto/pii-cipher.spec.ts`.

- [ ] **Step 1: Failing test** `src/common/crypto/pii-cipher.spec.ts`:
```typescript
import { PiiCipher } from './pii-cipher';
import { randomBytes } from 'node:crypto';

describe('PiiCipher', () => {
  const key = randomBytes(32).toString('base64');
  const cipher = new PiiCipher(key);

  it('round-trips plaintext', () => {
    const enc = cipher.encrypt('GHA-123456789-0');
    expect(enc).not.toContain('GHA-123456789-0');
    expect(cipher.decrypt(enc)).toBe('GHA-123456789-0');
  });

  it('produces different ciphertext each call (random iv)', () => {
    expect(cipher.encrypt('same')).not.toBe(cipher.encrypt('same'));
  });

  it('rejects a key that is not 32 bytes', () => {
    expect(() => new PiiCipher(Buffer.from('short').toString('base64'))).toThrow();
  });
});
```

- [ ] **Step 2: Run red:** `pnpm jest src/common/crypto/pii-cipher.spec.ts`

- [ ] **Step 3: Implement** `src/common/crypto/pii-cipher.ts`:
```typescript
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

// AES-256-GCM. Stored format: base64(iv[12] | authTag[16] | ciphertext).
export class PiiCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) {
      throw new Error('PII_ENCRYPTION_KEY must decode to exactly 32 bytes');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, enc]).toString('base64');
  }

  decrypt(payload: string): string {
    const buf = Buffer.from(payload, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const enc = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  }
}
```

- [ ] **Step 4: Run green** (3 tests): `pnpm jest src/common/crypto/pii-cipher.spec.ts`

- [ ] **Step 5: Commit**
```bash
git add src/common/crypto/pii-cipher.ts src/common/crypto/pii-cipher.spec.ts
git commit -m "feat: AES-256-GCM PII cipher

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: HMAC helper + shared RedisModule

**Files:** `src/common/crypto/hmac.ts`, `src/common/crypto/hmac.spec.ts`,
`src/common/redis/redis.service.ts`, `src/common/redis/redis.module.ts`.

- [ ] **Step 1: Failing test** `src/common/crypto/hmac.spec.ts`:
```typescript
import { hmac } from './hmac';

describe('hmac', () => {
  it('is deterministic for the same input and key', () => {
    expect(hmac('123456', 'secret')).toBe(hmac('123456', 'secret'));
  });
  it('differs for different inputs', () => {
    expect(hmac('123456', 'secret')).not.toBe(hmac('123457', 'secret'));
  });
  it('returns hex', () => {
    expect(hmac('x', 'secret')).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Run red:** `pnpm jest src/common/crypto/hmac.spec.ts`

- [ ] **Step 3: Implement** `src/common/crypto/hmac.ts`:
```typescript
import { createHmac } from 'node:crypto';

/** HMAC-SHA256 hex digest. Used to hash OTP codes and refresh tokens before storing in Redis. */
export function hmac(value: string, key: string): string {
  return createHmac('sha256', key).update(value).digest('hex');
}
```

- [ ] **Step 4: Run green:** `pnpm jest src/common/crypto/hmac.spec.ts`

- [ ] **Step 5: Implement `src/common/redis/redis.service.ts`** (shared ioredis client):
```typescript
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  readonly client: Redis;

  constructor(config: ConfigService) {
    this.client = new Redis(config.get<string>('REDIS_URL')!, { maxRetriesPerRequest: null });
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
```

- [ ] **Step 6: Implement `src/common/redis/redis.module.ts`** (global):
```typescript
import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service';

@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
```

- [ ] **Step 7: Commit**
```bash
git add src/common/crypto/hmac.ts src/common/crypto/hmac.spec.ts src/common/redis
git commit -m "feat: HMAC helper and shared RedisModule

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: AuthenticatedUser type, tier ordinal, decorators & guards — TDD

**Files:** `src/common/types/authenticated-user.ts`, `src/common/auth/tier.ts(+spec)`,
`src/common/decorators/{current-user,require-role,require-tier}.decorator.ts`,
`src/common/guards/{jwt-auth,roles,tier}.guard.ts` (+ specs for roles & tier guards).

- [ ] **Step 1: `src/common/types/authenticated-user.ts`**:
```typescript
import { Role, VerificationTier } from '@prisma/client';

export interface AuthenticatedUser {
  id: string;
  phone: string;
  roles: Role[];
  verificationTier: VerificationTier;
}
```

- [ ] **Step 2: Failing test for tier ordinal** `src/common/auth/tier.spec.ts`:
```typescript
import { VerificationTier } from '@prisma/client';
import { tierRank, meetsTier } from './tier';

describe('tier ordinal', () => {
  it('ranks T0<T1<T2<T3<T4', () => {
    expect(tierRank(VerificationTier.T0)).toBeLessThan(tierRank(VerificationTier.T4));
  });
  it('meetsTier is true when actual >= required', () => {
    expect(meetsTier(VerificationTier.T2, VerificationTier.T1)).toBe(true);
    expect(meetsTier(VerificationTier.T1, VerificationTier.T2)).toBe(false);
    expect(meetsTier(VerificationTier.T2, VerificationTier.T2)).toBe(true);
  });
});
```

- [ ] **Step 3: Run red:** `pnpm jest src/common/auth/tier.spec.ts`

- [ ] **Step 4: Implement `src/common/auth/tier.ts`**:
```typescript
import { VerificationTier } from '@prisma/client';

const ORDER: Record<VerificationTier, number> = {
  T0: 0, T1: 1, T2: 2, T3: 3, T4: 4,
};

export function tierRank(tier: VerificationTier): number {
  return ORDER[tier];
}

export function meetsTier(actual: VerificationTier, required: VerificationTier): boolean {
  return tierRank(actual) >= tierRank(required);
}
```

- [ ] **Step 5: Run green:** `pnpm jest src/common/auth/tier.spec.ts`

- [ ] **Step 6: Decorators.**
`src/common/decorators/current-user.decorator.ts`:
```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthenticatedUser } from '../types/authenticated-user';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    return ctx.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user;
  },
);
```
`src/common/decorators/require-role.decorator.ts`:
```typescript
import { SetMetadata } from '@nestjs/common';
import { Role } from '@prisma/client';

export const ROLES_KEY = 'roles';
export const RequireRole = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
```
`src/common/decorators/require-tier.decorator.ts`:
```typescript
import { SetMetadata } from '@nestjs/common';
import { VerificationTier } from '@prisma/client';

export const MIN_TIER_KEY = 'minTier';
export const RequireTier = (tier: VerificationTier) => SetMetadata(MIN_TIER_KEY, tier);
```

- [ ] **Step 7: JwtAuthGuard** `src/common/guards/jwt-auth.guard.ts`:
```typescript
import { ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedUser } from '../types/authenticated-user';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthenticatedUser>(err: unknown, user: TUser): TUser {
    if (err || !user) throw new UnauthorizedException();
    return user;
  }
}
```

- [ ] **Step 8: Failing test for RolesGuard** `src/common/guards/roles.guard.spec.ts`:
```typescript
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { RolesGuard } from './roles.guard';

function ctxWith(user: unknown): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows when no roles are required', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(ctxWith({ roles: [] }))).toBe(true);
  });
  it('allows when the user has one of the required roles', () => {
    const reflector = { getAllAndOverride: () => [Role.ADMIN] } as unknown as Reflector;
    expect(new RolesGuard(reflector).canActivate(ctxWith({ roles: [Role.ADMIN] }))).toBe(true);
  });
  it('denies when the user lacks the required role', () => {
    const reflector = { getAllAndOverride: () => [Role.ADMIN] } as unknown as Reflector;
    expect(() => new RolesGuard(reflector).canActivate(ctxWith({ roles: [Role.FARMER] }))).toThrow();
  });
});
```

- [ ] **Step 9: Run red:** `pnpm jest src/common/guards/roles.guard.spec.ts`

- [ ] **Step 10: Implement `src/common/guards/roles.guard.ts`**:
```typescript
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { ROLES_KEY } from '../decorators/require-role.decorator';
import { AppException, ErrorCode } from '../errors/error-codes';
import { AuthenticatedUser } from '../types/authenticated-user';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;
    const user = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (user && required.some((r) => user.roles.includes(r))) return true;
    throw new AppException(ErrorCode.FORBIDDEN, 'Insufficient role', 403);
  }
}
```

- [ ] **Step 11: Failing test for TierGuard** `src/common/guards/tier.guard.spec.ts`:
```typescript
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { VerificationTier } from '@prisma/client';
import { TierGuard } from './tier.guard';

function ctxWith(user: unknown): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('TierGuard', () => {
  it('allows when no tier required', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    expect(new TierGuard(reflector).canActivate(ctxWith({ verificationTier: 'T0' }))).toBe(true);
  });
  it('allows when tier is sufficient', () => {
    const reflector = { getAllAndOverride: () => VerificationTier.T1 } as unknown as Reflector;
    expect(new TierGuard(reflector).canActivate(ctxWith({ verificationTier: 'T2' }))).toBe(true);
  });
  it('denies (TIER_TOO_LOW) when tier is insufficient', () => {
    const reflector = { getAllAndOverride: () => VerificationTier.T2 } as unknown as Reflector;
    expect(() => new TierGuard(reflector).canActivate(ctxWith({ verificationTier: 'T1' }))).toThrow();
  });
});
```

- [ ] **Step 12: Run red:** `pnpm jest src/common/guards/tier.guard.spec.ts`

- [ ] **Step 13: Implement `src/common/guards/tier.guard.ts`**:
```typescript
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { VerificationTier } from '@prisma/client';
import { MIN_TIER_KEY } from '../decorators/require-tier.decorator';
import { AppException, ErrorCode } from '../errors/error-codes';
import { meetsTier } from '../auth/tier';
import { AuthenticatedUser } from '../types/authenticated-user';

@Injectable()
export class TierGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<VerificationTier | undefined>(MIN_TIER_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required) return true;
    const user = ctx.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user;
    if (user && meetsTier(user.verificationTier, required)) return true;
    throw new AppException(ErrorCode.TIER_TOO_LOW, `Requires verification tier ${required}`, 403);
  }
}
```

- [ ] **Step 14: Run green** (roles + tier guard specs): `pnpm jest src/common/guards src/common/auth`

- [ ] **Step 15: Commit**
```bash
git add src/common/types src/common/auth src/common/decorators src/common/guards
git commit -m "feat: authenticated-user type, tier ordinal, role/tier guards & decorators

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Hubtel integration + NotificationsModule (BullMQ)

**Files:** `src/workers/queue-names.ts`, `src/integrations/hubtel/hubtel.service.ts`,
`src/integrations/hubtel/hubtel.module.ts`, `src/modules/notifications/*`.

- [ ] **Step 1: `src/workers/queue-names.ts`**:
```typescript
export const QUEUES = {
  NOTIFICATIONS: 'notifications',
} as const;
```

- [ ] **Step 2: `src/integrations/hubtel/hubtel.service.ts`** (dev-stub sender):
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

export interface SendSmsParams {
  to: string;
  body: string;
  reference: string;
}

export interface SmsResult {
  messageId: string;
  status: 'sent' | 'queued' | 'failed' | 'logged';
}

@Injectable()
export class HubtelService {
  private readonly logger = new Logger(HubtelService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async sendSms(params: SendSmsParams): Promise<SmsResult> {
    const clientId = this.config.get<string>('HUBTEL_CLIENT_ID');
    const clientSecret = this.config.get<string>('HUBTEL_CLIENT_SECRET');
    const sender = this.config.get<string>('HUBTEL_SENDER_ID');

    // Dev stub: without credentials, log instead of sending. (Circuit breaker added in Step 7.)
    if (!clientId || !clientSecret || !sender) {
      this.logger.log(`[DEV SMS] to=${params.to} ref=${params.reference} body="${params.body}"`);
      return { messageId: `dev-${params.reference}`, status: 'logged' };
    }

    const url = `https://smsc.hubtel.com/v1/messages/send`;
    const res = await firstValueFrom(
      this.http.get(url, {
        params: { clientid: clientId, clientsecret: clientSecret, from: sender, to: params.to, content: params.body },
        timeout: 10_000,
      }),
    );
    const data = res.data as { MessageId?: string; Status?: number };
    return { messageId: data.MessageId ?? params.reference, status: data.Status === 0 ? 'sent' : 'queued' };
  }
}
```

- [ ] **Step 3: `src/integrations/hubtel/hubtel.module.ts`**:
```typescript
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { HubtelService } from './hubtel.service';

@Module({
  imports: [HttpModule],
  providers: [HubtelService],
  exports: [HubtelService],
})
export class HubtelModule {}
```

- [ ] **Step 4: `src/modules/notifications/notifications.processor.ts`**:
```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { QUEUES } from '../../workers/queue-names';
import { HubtelService, SendSmsParams } from '../../integrations/hubtel/hubtel.service';

@Processor(QUEUES.NOTIFICATIONS)
export class NotificationsProcessor extends WorkerHost {
  constructor(private readonly hubtel: HubtelService) {
    super();
  }

  async process(job: Job<SendSmsParams>): Promise<unknown> {
    if (job.name === 'send-sms') {
      return this.hubtel.sendSms(job.data);
    }
    return undefined;
  }
}
```

- [ ] **Step 5: `src/modules/notifications/notifications.service.ts`** (enqueue):
```typescript
import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUES } from '../../workers/queue-names';
import { SendSmsParams } from '../../integrations/hubtel/hubtel.service';

@Injectable()
export class NotificationsService {
  constructor(@InjectQueue(QUEUES.NOTIFICATIONS) private readonly queue: Queue) {}

  async sendSms(params: SendSmsParams): Promise<void> {
    await this.queue.add('send-sms', params, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
      removeOnFail: 50,
    });
  }
}
```

- [ ] **Step 6: `src/modules/notifications/notifications.module.ts`** (registers BullMQ root + the queue):
```typescript
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { QUEUES } from '../../workers/queue-names';
import { HubtelModule } from '../../integrations/hubtel/hubtel.module';
import { NotificationsService } from './notifications.service';
import { NotificationsProcessor } from './notifications.processor';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = new URL(config.get<string>('REDIS_URL')!);
        return { connection: { host: url.hostname, port: Number(url.port || 6379) } };
      },
    }),
    BullModule.registerQueue({ name: QUEUES.NOTIFICATIONS }),
    HubtelModule,
  ],
  providers: [NotificationsService, NotificationsProcessor],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

- [ ] **Step 7: Smoke-compile via build + commit** (no unit test for the queue here — exercised by the e2e in Task 11; verify it compiles):
```bash
pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -v 'app.module' || echo "tsc clean"
git add src/workers src/integrations/hubtel src/modules/notifications
git commit -m "feat: Hubtel SMS dev-stub + notifications BullMQ queue

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: OTP service — TDD

**Files:** `src/modules/auth/otp.service.ts`, `src/modules/auth/otp.service.spec.ts`.

The OTP service stores `hmac(code)` in Redis at `otp:<phone>` with a TTL, tracks attempts at
`otp:attempts:<phone>`, and throttles re-requests at `otp:throttle:<phone>`.

- [ ] **Step 1: Failing test** `src/modules/auth/otp.service.spec.ts` (uses real local Redis):
```typescript
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { OtpService } from './otp.service';
import { AppException } from '../../common/errors/error-codes';

const config = {
  get: (k: string) =>
    ({ JWT_SECRET: 'test-secret-1234567890', OTP_TTL_SECONDS: 300, OTP_LENGTH: 6, OTP_MAX_ATTEMPTS: 5 } as Record<string, unknown>)[k],
} as unknown as ConfigService;

describe('OtpService', () => {
  const client = new Redis('redis://localhost:6379', { maxRetriesPerRequest: null });
  const redis = { client } as { client: Redis };
  const svc = new OtpService(redis as never, config);
  const phone = `+233000${Date.now() % 1000000}`;

  afterAll(async () => {
    await client.del(`otp:${phone}`, `otp:attempts:${phone}`, `otp:throttle:${phone}`);
    client.disconnect();
  });

  it('generates a numeric code of OTP_LENGTH and verifies it', async () => {
    const code = await svc.generate(phone);
    expect(code).toMatch(/^\d{6}$/);
    await expect(svc.verify(phone, code)).resolves.toBeUndefined();
  });

  it('throws OTP_EXPIRED when no code exists', async () => {
    await expect(svc.verify(`+2330000000`, '000000')).rejects.toBeInstanceOf(AppException);
  });

  it('throws OTP_INVALID on wrong code', async () => {
    const p2 = `+2331${Date.now() % 100000}`;
    await svc.generate(p2);
    await expect(svc.verify(p2, '999999')).rejects.toBeInstanceOf(AppException);
    await client.del(`otp:${p2}`, `otp:attempts:${p2}`, `otp:throttle:${p2}`);
  });
});
```

- [ ] **Step 2: Run red:** `pnpm jest src/modules/auth/otp.service.spec.ts`

- [ ] **Step 3: Implement** `src/modules/auth/otp.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt } from 'node:crypto';
import { RedisService } from '../../common/redis/redis.service';
import { hmac } from '../../common/crypto/hmac';
import { AppException, ErrorCode } from '../../common/errors/error-codes';

@Injectable()
export class OtpService {
  constructor(
    private readonly redis: RedisService,
    private readonly config: ConfigService,
  ) {}

  /** Generate, hash, and store a code; returns the plaintext for the caller to send via SMS. */
  async generate(phone: string): Promise<string> {
    const throttleKey = `otp:throttle:${phone}`;
    if (await this.redis.client.get(throttleKey)) {
      throw new AppException(ErrorCode.OTP_THROTTLED, 'Please wait before requesting another code', 429);
    }
    const len = this.config.get<number>('OTP_LENGTH')!;
    const ttl = this.config.get<number>('OTP_TTL_SECONDS')!;
    const secret = this.config.get<string>('JWT_SECRET')!;
    const max = 10 ** len;
    const code = randomInt(0, max).toString().padStart(len, '0');

    await this.redis.client.set(`otp:${phone}`, hmac(code, secret), 'EX', ttl);
    await this.redis.client.del(`otp:attempts:${phone}`);
    await this.redis.client.set(throttleKey, '1', 'EX', 30); // 30s between requests
    return code;
  }

  /** Verify a code; throws OTP_EXPIRED / OTP_INVALID / OTP_THROTTLED. Deletes the code on success. */
  async verify(phone: string, code: string): Promise<void> {
    const key = `otp:${phone}`;
    const stored = await this.redis.client.get(key);
    if (!stored) throw new AppException(ErrorCode.OTP_EXPIRED, 'Code expired or not requested', 400);

    const max = this.config.get<number>('OTP_MAX_ATTEMPTS')!;
    const attempts = await this.redis.client.incr(`otp:attempts:${phone}`);
    if (attempts > max) {
      await this.redis.client.del(key);
      throw new AppException(ErrorCode.OTP_THROTTLED, 'Too many attempts', 429);
    }
    const secret = this.config.get<string>('JWT_SECRET')!;
    if (hmac(code, secret) !== stored) {
      throw new AppException(ErrorCode.OTP_INVALID, 'Incorrect code', 400);
    }
    await this.redis.client.del(key, `otp:attempts:${phone}`);
  }
}
```

- [ ] **Step 4: Run green:** `pnpm jest src/modules/auth/otp.service.spec.ts`

- [ ] **Step 5: Commit**
```bash
git add src/modules/auth/otp.service.ts src/modules/auth/otp.service.spec.ts
git commit -m "feat: OTP service (HMAC-hashed codes in Redis, throttle + attempts)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Token service (access JWT + rotating refresh)

**Files:** `src/modules/auth/token.service.ts`.

- [ ] **Step 1: Implement `src/modules/auth/token.service.ts`**:
```typescript
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { Role, VerificationTier } from '@prisma/client';
import { RedisService } from '../../common/redis/redis.service';
import { hmac } from '../../common/crypto/hmac';
import { AppException, ErrorCode } from '../../common/errors/error-codes';

export interface AccessClaims {
  sub: string;
  phone: string;
  roles: Role[];
  tier: VerificationTier;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly redis: RedisService,
  ) {}

  /** Sign just an access JWT from claims. */
  async signAccess(claims: AccessClaims): Promise<string> {
    return this.jwt.signAsync(claims, {
      secret: this.config.get<string>('JWT_SECRET'),
      expiresIn: this.config.get<string>('JWT_ACCESS_TTL'),
    });
  }

  async issue(claims: AccessClaims): Promise<TokenPair> {
    const accessToken = await this.signAccess(claims);
    const refreshToken = await this.newRefreshToken(claims.sub);
    return { accessToken, refreshToken };
  }

  // Refresh token format: `${userId}:${jti}.${secret}` — self-contained so refresh
  // needs no separate userId. Only hmac(secret) is stored in Redis.
  private async newRefreshToken(userId: string): Promise<string> {
    const jti = randomUUID();
    const secret = randomBytes(32).toString('hex');
    const ttl = this.config.get<number>('REFRESH_TTL_SECONDS')!;
    await this.redis.client.set(
      `refresh:${userId}:${jti}`,
      hmac(secret, this.config.get<string>('JWT_SECRET')!),
      'EX',
      ttl,
    );
    return `${userId}:${jti}.${secret}`;
  }

  /** Validate + rotate a refresh token; returns the userId and a fresh refresh token. */
  async rotate(refreshToken: string): Promise<{ userId: string; refreshToken: string }> {
    const sep = refreshToken.indexOf(':');
    const dot = refreshToken.indexOf('.');
    if (sep < 0 || dot < 0 || dot < sep) {
      throw new AppException(ErrorCode.REFRESH_INVALID, 'Malformed refresh token', 401);
    }
    const userId = refreshToken.slice(0, sep);
    const jti = refreshToken.slice(sep + 1, dot);
    const secret = refreshToken.slice(dot + 1);
    const key = `refresh:${userId}:${jti}`;
    const stored = await this.redis.client.get(key);
    if (!stored || stored !== hmac(secret, this.config.get<string>('JWT_SECRET')!)) {
      throw new AppException(ErrorCode.REFRESH_INVALID, 'Invalid refresh token', 401);
    }
    await this.redis.client.del(key); // rotate: invalidate old
    const next = await this.newRefreshToken(userId);
    return { userId, refreshToken: next };
  }

  async revokeAll(userId: string): Promise<void> {
    const keys = await this.redis.client.keys(`refresh:${userId}:*`);
    if (keys.length) await this.redis.client.del(...keys);
  }
}
```

- [ ] **Step 2: Compile-check + commit** (TokenService is exercised by the e2e in Task 12):
```bash
pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -v 'app.module' || echo "tsc clean"
git add src/modules/auth/token.service.ts
git commit -m "feat: token service (access JWT + rotating refresh in Redis)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: JWT strategy + Users repository/service + /me

**Files:** `src/modules/auth/jwt.strategy.ts`, `src/modules/users/users.repository.ts`,
`src/modules/users/users.service.ts`, `src/modules/users/dto/user-response.dto.ts`.

- [ ] **Step 1: `src/modules/users/users.repository.ts`** (Prisma only, via `db` for soft-delete):
```typescript
import { Injectable } from '@nestjs/common';
import { Prisma, Role, User, VerificationTier } from '@prisma/client';
import { PrismaService } from '../../common/services/prisma.service';

@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByPhone(phone: string): Promise<(User & { roles: { role: Role }[] }) | null> {
    return this.prisma.db.user.findFirst({ where: { phone }, include: { roles: true } });
  }

  findById(id: string): Promise<(User & { roles: { role: Role }[] }) | null> {
    return this.prisma.db.user.findFirst({ where: { id }, include: { roles: true } });
  }

  create(data: Prisma.UserCreateInput): Promise<User & { roles: { role: Role }[] }> {
    return this.prisma.user.create({ data, include: { roles: true } });
  }

  update(id: string, data: Prisma.UserUpdateInput): Promise<User & { roles: { role: Role }[] }> {
    return this.prisma.user.update({ where: { id }, data, include: { roles: true } });
  }

  setTier(id: string, tier: VerificationTier): Promise<User> {
    return this.prisma.user.update({ where: { id }, data: { verificationTier: tier } });
  }

  addRole(userId: string, role: Role) {
    return this.prisma.userRole.upsert({
      where: { userId_role: { userId, role } },
      create: { userId, role },
      update: {},
    });
  }

  removeRole(userId: string, role: Role) {
    return this.prisma.userRole.deleteMany({ where: { userId, role } });
  }

  list(take: number, skip: number) {
    return this.prisma.db.user.findMany({ take, skip, orderBy: { createdAt: 'desc' }, include: { roles: true } });
  }
}
```

- [ ] **Step 2: `src/modules/users/dto/user-response.dto.ts`** (never expose PII):
```typescript
import { ApiProperty } from '@nestjs/swagger';
import { Role, User, UserStatus, VerificationTier } from '@prisma/client';

export class UserResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() phone!: string;
  @ApiProperty({ nullable: true }) email!: string | null;
  @ApiProperty() displayName!: string;
  @ApiProperty({ nullable: true }) orgName!: string | null;
  @ApiProperty() preferredLocale!: string;
  @ApiProperty({ nullable: true }) defaultRegionCode!: string | null;
  @ApiProperty({ enum: ['T0', 'T1', 'T2', 'T3', 'T4'] }) verificationTier!: VerificationTier;
  @ApiProperty() status!: UserStatus;
  @ApiProperty({ isArray: true }) roles!: Role[];
  @ApiProperty() createdAt!: string;

  static from(user: User & { roles: { role: Role }[] }): UserResponseDto {
    return {
      id: user.id,
      phone: user.phone,
      email: user.email,
      displayName: user.displayName,
      orgName: user.orgName,
      preferredLocale: user.preferredLocale,
      defaultRegionCode: user.defaultRegionCode,
      verificationTier: user.verificationTier,
      status: user.status,
      roles: user.roles.map((r) => r.role),
      createdAt: user.createdAt.toISOString(),
    };
  }
}
```

- [ ] **Step 3: `src/modules/users/users.service.ts`**:
```typescript
import { Injectable } from '@nestjs/common';
import { Role } from '@prisma/client';
import { UsersRepository } from './users.repository';
import { UserResponseDto } from './dto/user-response.dto';
import { AppException, ErrorCode } from '../../common/errors/error-codes';

@Injectable()
export class UsersService {
  constructor(private readonly repo: UsersRepository) {}

  async getById(id: string): Promise<UserResponseDto> {
    const user = await this.repo.findById(id);
    if (!user) throw new AppException(ErrorCode.USER_NOT_FOUND, 'User not found', 404);
    return UserResponseDto.from(user);
  }

  async updateProfile(id: string, data: { displayName?: string; email?: string; orgName?: string; defaultRegionCode?: string; preferredLocale?: 'EN' | 'TW' | 'EE' | 'DA' }): Promise<UserResponseDto> {
    const user = await this.repo.update(id, data);
    return UserResponseDto.from(user);
  }

  async list(take = 50, skip = 0): Promise<UserResponseDto[]> {
    const users = await this.repo.list(take, skip);
    return users.map(UserResponseDto.from);
  }

  async grantRole(userId: string, role: Role): Promise<UserResponseDto> {
    await this.repo.addRole(userId, role);
    return this.getById(userId);
  }

  async revokeRole(userId: string, role: Role): Promise<UserResponseDto> {
    await this.repo.removeRole(userId, role);
    return this.getById(userId);
  }
}
```

- [ ] **Step 4: `src/modules/auth/jwt.strategy.ts`** (extract from cookie or bearer; verify user ACTIVE):
```typescript
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { UsersRepository } from '../users/users.repository';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AccessClaims } from './token.service';

function fromCookie(req: Request): string | null {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.az_access ?? null;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService,
    private readonly users: UsersRepository,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([fromCookie, ExtractJwt.fromAuthHeaderAsBearerToken()]),
      secretOrKey: config.get<string>('JWT_SECRET')!,
      ignoreExpiration: false,
    });
  }

  async validate(payload: AccessClaims): Promise<AuthenticatedUser> {
    const user = await this.users.findById(payload.sub);
    if (!user || user.status !== 'ACTIVE') throw new UnauthorizedException();
    return {
      id: user.id,
      phone: user.phone,
      roles: user.roles.map((r) => r.role),
      verificationTier: user.verificationTier,
    };
  }
}
```

- [ ] **Step 5: Compile-check + commit**
```bash
pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -v 'app.module' || echo "tsc clean"
git add src/modules/users/users.repository.ts src/modules/users/users.service.ts src/modules/users/dto src/modules/auth/jwt.strategy.ts
git commit -m "feat: users repository/service + /me DTO + JWT strategy

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Auth service, controllers, modules wiring

**Files:** `src/modules/auth/events/tier-changed.event.ts`, `src/modules/auth/auth.service.ts`,
`src/modules/auth/dto/*.ts`, `src/modules/auth/auth.controller.ts`,
`src/modules/users/users.controller.ts`, `src/modules/auth/auth.module.ts`,
`src/modules/users/users.module.ts`.

- [ ] **Step 1: Event** `src/modules/auth/events/tier-changed.event.ts`:
```typescript
import { VerificationTier } from '@prisma/client';

export class TierChangedEvent {
  constructor(
    public readonly userId: string,
    public readonly fromTier: VerificationTier,
    public readonly toTier: VerificationTier,
    public readonly method: string,
  ) {}
}
```

- [ ] **Step 2: DTOs** `src/modules/auth/dto/request-otp.dto.ts`, `verify-otp.dto.ts`:
```typescript
// request-otp.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class RequestOtpDto {
  @ApiProperty({ example: '+233245550142' })
  @IsString()
  @Matches(/^\+?\d{8,15}$/, { message: 'phone must be a valid E.164-ish number' })
  phone!: string;
}
```
```typescript
// verify-otp.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class VerifyOtpDto {
  @ApiProperty({ example: '+233245550142' })
  @IsString()
  @Matches(/^\+?\d{8,15}$/)
  phone!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @Matches(/^\d{4,8}$/)
  code!: string;
}
```
Also `src/modules/users/dto/update-profile.dto.ts`:
```typescript
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(2) displayName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() orgName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() defaultRegionCode?: string;
  @ApiPropertyOptional({ enum: ['EN', 'TW', 'EE', 'DA'] }) @IsOptional() @IsIn(['EN', 'TW', 'EE', 'DA']) preferredLocale?: 'EN' | 'TW' | 'EE' | 'DA';
}
```
And `src/modules/users/dto/grant-role.dto.ts`:
```typescript
import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { Role } from '@prisma/client';

const ROLES = ['FARMER','BUYER','AGGREGATOR','INPUT_SUPPLIER','INVESTOR','FIELD_AGENT','REGIONAL_SUPERVISOR','AGRONOMIST','TREASURY_OFFICER','COMPLIANCE_OFFICER','TRUST_REVIEWER','ADMIN'] as const;

export class GrantRoleDto {
  @ApiProperty({ enum: ROLES })
  @IsIn(ROLES)
  role!: Role;
}
```

- [ ] **Step 3: `src/modules/auth/auth.service.ts`**:
```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { VerificationTier } from '@prisma/client';
import { UsersRepository } from '../users/users.repository';
import { OtpService } from './otp.service';
import { TokenService, TokenPair } from './token.service';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditService } from '../audit/audit.service';
import { TierChangedEvent } from './events/tier-changed.event';
import { AppException, ErrorCode } from '../../common/errors/error-codes';

export interface RequestOtpResult {
  sent: boolean;
  debugCode?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersRepository,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly config: ConfigService,
  ) {}

  async requestOtp(phone: string): Promise<RequestOtpResult> {
    let user = await this.users.findByPhone(phone);
    if (!user) {
      user = await this.users.create({ phone, displayName: phone });
    }
    const code = await this.otp.generate(phone);
    await this.notifications.sendSms({
      to: phone,
      body: `Your AgriZone code is ${code}. It expires in 5 minutes.`,
      reference: `otp-${user.id}`,
    });
    const isProd = this.config.get<string>('NODE_ENV') === 'production';
    return { sent: true, ...(isProd ? {} : { debugCode: code }) };
  }

  async verifyOtp(phone: string, code: string): Promise<TokenPair & { tier: VerificationTier }> {
    await this.otp.verify(phone, code);
    let user = await this.users.findByPhone(phone);
    if (!user) {
      user = await this.users.create({ phone, displayName: phone });
    }
    if (user.verificationTier === VerificationTier.T0) {
      await this.users.setTier(user.id, VerificationTier.T1);
      user.verificationTier = VerificationTier.T1;
      await this.audit.record({
        actorUserId: user.id,
        action: 'verification.tier-changed',
        entityType: 'User',
        entityId: user.id,
        after: { tier: 'T1', method: 'PHONE_OTP' },
      });
      this.events.emit('verification.tier-changed', new TierChangedEvent(user.id, VerificationTier.T0, VerificationTier.T1, 'PHONE_OTP'));
    }
    const pair = await this.tokens.issue({
      sub: user.id,
      phone: user.phone,
      roles: user.roles.map((r) => r.role),
      tier: user.verificationTier,
    });
    return { ...pair, tier: user.verificationTier };
  }

  async refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }> {
    const { userId, refreshToken: next } = await this.tokens.rotate(refreshToken);
    const user = await this.users.findById(userId);
    if (!user) throw new AppException(ErrorCode.REFRESH_INVALID, 'Unknown user', 401);
    const accessToken = await this.tokens.signAccess({
      sub: user.id,
      phone: user.phone,
      roles: user.roles.map((r) => r.role),
      tier: user.verificationTier,
    });
    return { accessToken, refreshToken: next };
  }

  async logout(userId: string): Promise<void> {
    await this.tokens.revokeAll(userId);
  }
}
```
> Note: `refresh` issues a fresh access token AND uses `tokens.rotate` for the refresh side.
> The `tokens.issue` call also mints a refresh token we discard — acceptable for Phase 0; a
> dedicated `signAccess` could be factored later. Keep as-is unless the reviewer objects.

- [ ] **Step 4: `src/modules/auth/auth.controller.ts`** (sets HttpOnly cookies + returns body):
```typescript
import { Body, Controller, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AppException, ErrorCode } from '../../common/errors/error-codes';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  private setCookies(res: Response, accessToken: string, refreshToken: string): void {
    const secure = process.env.NODE_ENV === 'production';
    res.cookie('az_access', accessToken, { httpOnly: true, sameSite: 'lax', secure, path: '/' });
    res.cookie('az_refresh', refreshToken, { httpOnly: true, sameSite: 'lax', secure, path: '/v1/auth' });
  }

  @Post('request-otp')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp(dto.phone);
  }

  @Post('verify-otp')
  async verifyOtp(@Body() dto: VerifyOtpDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.verifyOtp(dto.phone, dto.code);
    this.setCookies(res, result.accessToken, result.refreshToken);
    return { accessToken: result.accessToken, refreshToken: result.refreshToken, tier: result.tier };
  }

  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
    const refreshToken = cookies.az_refresh ?? (req.body as { refreshToken?: string })?.refreshToken;
    if (!refreshToken) throw new AppException(ErrorCode.REFRESH_INVALID, 'Missing refresh token', 401);
    const result = await this.auth.refresh(refreshToken);
    this.setCookies(res, result.accessToken, result.refreshToken);
    return result;
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@CurrentUser() user: AuthenticatedUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(user.id);
    res.clearCookie('az_access', { path: '/' });
    res.clearCookie('az_refresh', { path: '/v1/auth' });
    return { ok: true };
  }
}
```
> The refresh token is self-contained (`${userId}:${jti}.${secret}`), so `auth.refresh(refreshToken)`
> derives the user itself — no separate userId is parsed in the controller (see TokenService in Task 8).

- [ ] **Step 5: `src/modules/users/users.controller.ts`**:
```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { GrantRoleDto } from './dto/grant-role.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { RequireRole } from '../../common/decorators/require-role.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/authenticated-user';

@ApiTags('users')
@Controller()
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.users.getById(user.id);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto);
  }

  @Get('users')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole(Role.ADMIN)
  list(@Query('take') take?: string, @Query('skip') skip?: string) {
    return this.users.list(take ? Number(take) : 50, skip ? Number(skip) : 0);
  }

  @Get('users/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole(Role.ADMIN)
  getOne(@Param('id') id: string) {
    return this.users.getById(id);
  }

  @Post('users/:id/roles')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole(Role.ADMIN)
  grant(@Param('id') id: string, @Body() dto: GrantRoleDto) {
    return this.users.grantRole(id, dto.role);
  }

  @Delete('users/:id/roles/:role')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @RequireRole(Role.ADMIN)
  revoke(@Param('id') id: string, @Param('role') role: Role) {
    return this.users.revokeRole(id, role);
  }
}
```

- [ ] **Step 6: Modules.**
`src/modules/users/users.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { UsersRepository } from './users.repository';

@Module({
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
  exports: [UsersService, UsersRepository],
})
export class UsersModule {}
```
`src/modules/auth/auth.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';
import { JwtStrategy } from './jwt.strategy';
import { UsersModule } from '../users/users.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    PassportModule,
    UsersModule,
    NotificationsModule,
    AuditModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({ secret: config.get<string>('JWT_SECRET') }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, OtpService, TokenService, JwtStrategy],
})
export class AuthModule {}
```

- [ ] **Step 7: Compile-check + commit**
```bash
pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -v 'app.module' || echo "tsc clean"
git add src/modules/auth src/modules/users
git commit -m "feat: auth service + controllers, users controller, module wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Audit module (service + repository + global interceptor)

**Files:** `src/modules/audit/audit.repository.ts`, `audit.service.ts`, `audit.interceptor.ts`,
`audit.module.ts`.

- [ ] **Step 1: `src/modules/audit/audit.repository.ts`**:
```typescript
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/services/prisma.service';

@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.AuditLogCreateInput) {
    return this.prisma.auditLog.create({ data });
  }
}
```

- [ ] **Step 2: `src/modules/audit/audit.service.ts`**:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditRepository } from './audit.repository';

export interface AuditRecord {
  actorUserId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  ip?: string;
  userAgent?: string;
  correlationId?: string;
  before?: unknown;
  after?: unknown;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly repo: AuditRepository) {}

  /** Fire-and-forget audit write; never throws into the caller. */
  async record(rec: AuditRecord): Promise<void> {
    try {
      await this.repo.create({
        actorUserId: rec.actorUserId ?? null,
        action: rec.action,
        entityType: rec.entityType,
        entityId: rec.entityId ?? null,
        ip: rec.ip ?? null,
        userAgent: rec.userAgent ?? null,
        correlationId: rec.correlationId ?? null,
        // Prisma Json? fields reject JS null — use Prisma.JsonNull for "no value".
        before: rec.before === undefined ? Prisma.JsonNull : (rec.before as Prisma.InputJsonValue),
        after: rec.after === undefined ? Prisma.JsonNull : (rec.after as Prisma.InputJsonValue),
      });
    } catch (err) {
      this.logger.error(`Failed to write audit log for ${rec.action}`, err as Error);
    }
  }
}
```

- [ ] **Step 3: `src/modules/audit/audit.interceptor.ts`** (global; audits mutating verbs):
```typescript
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { Request } from 'express';
import { AuditService } from './audit.service';
import { AuthenticatedUser } from '../../common/types/authenticated-user';

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthenticatedUser; correlationId?: string }>();
    if (!MUTATING.has(req.method)) return next.handle();

    return next.handle().pipe(
      tap(() => {
        // do not block the response; do not log request bodies (may contain OTP codes / PII)
        void this.audit.record({
          actorUserId: req.user?.id,
          action: `${req.method} ${req.route?.path ?? req.url}`,
          entityType: 'http',
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          correlationId: req.correlationId,
        });
      }),
    );
  }
}
```

- [ ] **Step 4: `src/modules/audit/audit.module.ts`** (global, exports AuditService):
```typescript
import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditRepository } from './audit.repository';

@Global()
@Module({
  providers: [AuditService, AuditRepository],
  exports: [AuditService],
})
export class AuditModule {}
```

- [ ] **Step 5: Compile-check + commit**
```bash
pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -v 'app.module' || echo "tsc clean"
git add src/modules/audit
git commit -m "feat: audit module (service, repository, global interceptor)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Wire everything into the app + cookie-parser + e2e

**Files:** `src/app.module.ts`, `src/main.ts`, `test/auth.e2e-spec.ts`.

- [ ] **Step 1: Add EventEmitter + new modules + global AuditInterceptor to `src/app.module.ts`.**
(`@nestjs/event-emitter` was already installed in Task 1.)
Edit `src/app.module.ts` imports to add (keep all existing):
```typescript
import { EventEmitterModule } from '@nestjs/event-emitter';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { RedisModule } from './common/redis/redis.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuditInterceptor } from './modules/audit/audit.interceptor';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
```
Add to `imports: [...]`: `EventEmitterModule.forRoot()`, `RedisModule`, `AuditModule`,
`NotificationsModule`, `UsersModule`, `AuthModule`. Add a `providers` array to the `@Module`:
```typescript
  providers: [{ provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
```

- [ ] **Step 2: Enable cookie-parser in `src/main.ts`** — add after `const app = ...`:
```typescript
import cookieParser from 'cookie-parser';
// ...
app.use(cookieParser());
```
(If `import cookieParser from 'cookie-parser'` errors under nodenext, use
`import * as cookieParser from 'cookie-parser';` and call `app.use(cookieParser())`.)

- [ ] **Step 3: Build + boot smoke**
```bash
pnpm build
# boot, request OTP, verify, hit /me
PORT=3001 pnpm start > /tmp/az-s2.log 2>&1 &
P=$!; for i in $(seq 1 20); do curl -sf http://localhost:3001/v1/health >/dev/null && break; sleep 1; done
PHONE="+233245550142"
OTP=$(curl -s -X POST http://localhost:3001/v1/auth/request-otp -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\"}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).debugCode))")
echo "debugCode=$OTP"
VERIFY=$(curl -s -X POST http://localhost:3001/v1/auth/verify-otp -H 'content-type: application/json' -d "{\"phone\":\"$PHONE\",\"code\":\"$OTP\"}")
echo "verify=$VERIFY"
TOKEN=$(echo "$VERIFY" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).accessToken))")
echo "me=$(curl -s http://localhost:3001/v1/me -H "authorization: Bearer $TOKEN")"
kill $P 2>/dev/null
```
Expected: `verify` returns `tier: "T1"` + tokens; `me` returns the user with `verificationTier: "T1"`.

- [ ] **Step 4: e2e test** `test/auth.e2e-spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module';
import { AllExceptionsFilter } from './../src/common/filters/all-exceptions.filter';

describe('Auth (e2e)', () => {
  let app: INestApplication;
  const phone = `+23324555${Math.floor(1000 + (Date.now() % 9000))}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.enableShutdownHooks(); // lets the BullMQ worker + Redis close on app.close()
    app.setGlobalPrefix('v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  // If jest reports open handles from the BullMQ worker / Redis despite app.close(),
  // run e2e with `pnpm test:e2e -- --forceExit` (acceptable — the assertions are what matter).

  afterAll(async () => {
    await app.close();
  });

  it('signs up via phone OTP, reaches T1, and reads /me', async () => {
    const otpRes = await request(app.getHttpServer())
      .post('/v1/auth/request-otp')
      .send({ phone })
      .expect(201);
    const code = otpRes.body.debugCode as string;
    expect(code).toMatch(/^\d{6}$/);

    const verifyRes = await request(app.getHttpServer())
      .post('/v1/auth/verify-otp')
      .send({ phone, code })
      .expect(201);
    expect(verifyRes.body.tier).toBe('T1');
    const token = verifyRes.body.accessToken as string;
    expect(token).toBeTruthy();

    const meRes = await request(app.getHttpServer())
      .get('/v1/me')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(meRes.body.phone).toBe(phone);
    expect(meRes.body.verificationTier).toBe('T1');

    const unauth = await request(app.getHttpServer()).get('/v1/me').expect(401);
    expect(unauth.body.error.code).toBe('UNAUTHORIZED');
  });
});
```

- [ ] **Step 5: Run the full suites**
```bash
pnpm test          # all unit specs green
pnpm test:e2e      # health + auth e2e green
pnpm lint          # exit 0
```

- [ ] **Step 6: Commit**
```bash
git add src/app.module.ts src/main.ts test/auth.e2e-spec.ts package.json pnpm-lock.yaml
git commit -m "feat: wire identity modules + cookie-parser + auth e2e (OTP -> T1 -> /me)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Done-when (Step 2 acceptance)

- `POST /v1/auth/request-otp` creates a T0 user and queues an SMS (dev: returns `debugCode`).
- `POST /v1/auth/verify-otp` validates the code, promotes T0→T1, audits + emits the event,
  and returns access + refresh tokens (also HttpOnly cookies).
- `GET /v1/me` returns the authenticated user (no PII fields); unauthenticated → 401 `UNAUTHORIZED`.
- `@RequireRole`/`@RequireTier` guards enforce admin/tier on the `users` endpoints.
- Every mutating request writes an `AuditLog` row (no request bodies / PII logged).
- `pnpm lint` (0 errors), `pnpm build`, `pnpm test`, `pnpm test:e2e` all green; `tsc` clean.

## Hand-off to Step 3 (KYC & Verification)
Step 3 adds `KycModule` (NIA GhanaCard → T2, using the `PiiCipher` to store the card number),
`VerificationModule` (the tier state machine + `VerificationEvent` model, subscribing to
`verification.tier-changed` to persist the event Auth already emits), and the NIA integration.
