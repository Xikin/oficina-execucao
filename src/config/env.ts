import { z } from 'zod';
import 'dotenv/config';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),

  JWT_SECRET: z.string().min(32),

  ALLOWED_ORIGINS: z.string().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  SWAGGER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  NEW_RELIC_LICENSE_KEY: z.string().optional(),
  NEW_RELIC_APP_NAME: z.string().default('oficina-execucao'),

  RABBITMQ_URL: z.string().url().optional(),
  RABBITMQ_EXCHANGE: z.string().default('oficina.saga'),
  MENSAGERIA_MAX_TENTATIVAS: z.coerce.number().int().positive().default(5),
  MENSAGERIA_ATRASO_RETENTATIVA_MS: z.coerce.number().int().positive().default(5000),
  OUTBOX_INTERVALO_MS: z.coerce.number().int().positive().default(1000),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Variáveis de ambiente inválidas:', result.error.flatten().fieldErrors);
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
