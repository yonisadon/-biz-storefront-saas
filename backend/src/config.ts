import { z } from 'zod';

const Env = z.object({
  PORT: z.coerce.number().default(3000),
  APP_DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(['true', 'false']).default('false'),
  MEDIA_BASE_URL: z.string().url(),
  CORS_ORIGINS: z.string().default(''),
});

export const env = Env.parse(process.env);
