import { z } from 'zod';

const Env = z.object({
  PORT: z.coerce.number().default(3000),
  APP_DATABASE_URL: z.string().min(1),
  DATABASE_SSL: z.enum(['true', 'false']).default('false'),
  MEDIA_BASE_URL: z.string().url(),
  CORS_ORIGINS: z.string().default(''),
  SUPERADMIN_DATABASE_URL: z.string().optional(),
  // PostgreSQL owner/CREATEDB-capable connection used only for provisioning.
  DATABASE_ADMIN_URL: z.string().optional(),
  SUPERADMIN_API_TOKEN: z.string().min(32).optional(),
  PUBLIC_BASE_URL: z.string().url().optional(),

  // שדות חדשים שהתווספו לניהול תמונות ואחסון:
  STORAGE_DRIVER: z.enum(['s3', 'local']).default('local'),
  LOCAL_STORAGE_DIR: z.string().default('./.storage'),
  S3_ENDPOINT: z.string().url().optional().or(z.literal('')),
  S3_REGION: z.string().default('auto'),
  S3_BUCKET: z.string().optional().or(z.literal('')),
  S3_ACCESS_KEY_ID: z.string().optional().or(z.literal('')),
  S3_SECRET_ACCESS_KEY: z.string().optional().or(z.literal('')),
  S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).default('true'),
});

export const env = Env.parse(process.env);
// import { z } from 'zod';
//
// const Env = z.object({
//   PORT: z.coerce.number().default(3000),
//   APP_DATABASE_URL: z.string().min(1),
//   DATABASE_SSL: z.enum(['true', 'false']).default('false'),
//   MEDIA_BASE_URL: z.string().url(),
//   CORS_ORIGINS: z.string().default(''),
// });
//
// export const env = Env.parse(process.env);
