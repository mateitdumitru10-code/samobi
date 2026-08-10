// Fake configuration so `src/env.ts` validates during unit tests.
// Tests that touch a real database get their connection from .env instead.
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL ??= 'postgresql://postgres:postgres@localhost:5432/postgres'
process.env.DIRECT_URL ??= 'postgresql://postgres:postgres@localhost:5432/postgres'
process.env.SUPABASE_URL ??= 'http://localhost:54321'
process.env.SUPABASE_ANON_KEY ??= 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'test-service-role-key'
