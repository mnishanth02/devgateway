import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/schema/**/*.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url:
      process.env.DATABASE_MIGRATION_URL ??
      process.env.OPERATIONAL_DATABASE_URL ??
      process.env.DATABASE_URL ??
      'postgres://localhost/devgateway',
  },
  strict: true,
  verbose: true,
});
