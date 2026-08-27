import { createApp } from "./app.js";
import { env } from "./env.js";
import { pool } from "./db.js";

const app = createApp();

const server = app.listen(env.PORT, () => {
  console.log(`Northbeam CRM backend listening on port ${env.PORT} (${env.NODE_ENV})`);
});

async function shutdown(signal: string) {
  console.log(`Received ${signal}, shutting down...`);
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
