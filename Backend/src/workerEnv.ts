import "dotenv/config";
import { z } from "zod";

/**
 * Environment required ONLY by the automation worker process
 * (src/worker.ts) and its providers (src/providers/*.ts) — deliberately
 * kept out of env.ts so the API server (src/index.ts) can start without
 * send credentials configured. Importing this module is what pulls in the
 * requirement; index.ts/app.ts/routes/services never import it.
 */
const WorkerEnvSchema = z.object({
  // Outbound email (nurture-workflow send_email steps), used by
  // src/providers/email.provider.ts.
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.string().default("false").transform((value) => value === "true"),
  SMTP_USER: z.string().min(1),
  SMTP_PASS: z.string().min(1),
  SMTP_FROM_NAME: z.string().default("MOTM Technologies"),
  SMTP_FROM_ADDRESS: z.string().email(),

  // Outbound WhatsApp (nurture-workflow send_whatsapp steps) via the Meta
  // WhatsApp Cloud API, used by src/providers/whatsapp.provider.ts.
  META_WHATSAPP_API_VERSION: z.string().default("v23.0"),
  META_WHATSAPP_PHONE_NUMBER_ID: z.string().min(1),
  META_WHATSAPP_ACCESS_TOKEN: z.string().min(1),
  META_WHATSAPP_APP_SECRET: z.string().min(1),
  META_WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().min(1),

  // src/worker.ts poll loop.
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).default(10_000),
  WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  WORKER_DRY_RUN: z.string().default("false").transform((value) => value === "true"),
});

function loadWorkerEnv() {
  const parsed = WorkerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid worker environment configuration:", parsed.error.flatten().fieldErrors);
    throw new Error(
      "Invalid worker environment configuration. src/worker.ts needs SMTP_*/META_WHATSAPP_*/WORKER_* set even " +
        "though the API server does not — see .env.example.",
    );
  }
  return parsed.data;
}

export const workerEnv = loadWorkerEnv();
