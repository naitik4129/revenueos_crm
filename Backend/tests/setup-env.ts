process.env.DATABASE_URL ??= "postgres://postgres:postgres@127.0.0.1:5432/postgres";
process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.INTEGRATION_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.NODE_ENV = "test";
