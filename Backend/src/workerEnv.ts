import "dotenv/config";
import { z } from "zod";

const WorkerEnvSchema = z.object({
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(1_000).default(10_000),
  WORKER_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
  WORKER_DRY_RUN: z.string().default("false").transform((value) => value === "true"),
});

function loadWorkerEnv() {
  const parsed = WorkerEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid worker environment configuration:", parsed.error.flatten().fieldErrors);
    throw new Error("Invalid worker environment configuration. Check WORKER_* values in .env.example.");
  }
  return parsed.data;
}

export const workerEnv = loadWorkerEnv();
