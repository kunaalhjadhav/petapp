import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed/seed.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL ?? '',
    // Needed by `migrate diff --from-migrations` (drift check) and `migrate dev`.
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
