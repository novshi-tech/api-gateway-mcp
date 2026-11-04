import { defineConfig } from 'drizzle-kit';

// マイグレーションの SQL を作るだけ（npm run db:generate）。当てるのは wrangler d1 migrations apply（npm run db:migrate）
export default defineConfig({
  schema: './src/store/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
});
