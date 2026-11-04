import { defineConfig } from 'drizzle-kit';

// マイグレーションの SQL を作るだけ（pnpm db:generate）。当てるのは wrangler d1 migrations apply（pnpm db:migrate）
export default defineConfig({
  schema: './src/store/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
});
