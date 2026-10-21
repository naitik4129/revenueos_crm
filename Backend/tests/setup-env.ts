process.env.DATABASE_URL ??= "postgres://postgres:postgres@127.0.0.1:5432/postgres";
process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.INTEGRATION_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.NODE_ENV = "test";
// Email safety (always these values in tests, whatever .env says).
process.env.PUBLIC_API_URL = "https://crm-api.test";
process.env.RESEND_WEBHOOK_SECRET = `whsec_${Buffer.alloc(24, 9).toString("base64")}`;
