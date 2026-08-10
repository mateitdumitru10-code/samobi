import { defineConfig } from 'drizzle-kit'

// drizzle-kit runs DDL. It must use the direct connection, never the transaction
// pooler — see CLAUDE.md, "Conexiuni".
export default defineConfig({
  schema: './src/db/schema.ts',
  out: '../../supabase/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DIRECT_URL ?? '',
  },
  schemaFilter: ['public'],
  // Timestamped filenames, so `supabase db push` accepts what drizzle-kit writes.
  migrations: { prefix: 'supabase' },
  verbose: true,
  strict: true,
})
