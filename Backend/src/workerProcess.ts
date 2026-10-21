// Imported first by worker.ts so db.ts sizes the pool for the worker (WORKER_DB_POOL_MAX), not the API.
process.env.CRM_PROCESS = "worker";
