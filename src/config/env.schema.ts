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
