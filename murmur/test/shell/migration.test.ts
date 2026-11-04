import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { describe, expect, it } from 'vitest';

// D1 のマイグレーション（drizzle/）。古い形のマスタの行に 0001 を当てても、行のキーが作られて残る（0030 の 5）

describe('マイグレーション', () => {
  it('H3 0001: マスタの行に key を付ける（id、ListMember は listId|読者、AttributeDef は dataSourceId|name）', async () => {
    const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default {}', d1Databases: ['DB'] }));
    try {
      const d1 = (await mf.getD1Database('DB')) as unknown as D1Database;
      const dir = join(import.meta.dirname, '../../drizzle');
      const apply = async (file: string) => {
        for (const stmt of readFileSync(join(dir, file), 'utf8').split('--> statement-breakpoint')) if (stmt.trim()) await d1.prepare(stmt).run();
      };
      const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
      await apply(files[0]!);
      const insert = d1.prepare('INSERT INTO master (kind, ord, data) VALUES (?, ?, ?)');
      await insert.bind('contacts', 0, JSON.stringify({ id: 'p_kimura', name: '木村' })).run();
      await insert.bind('listMembers', 0, JSON.stringify({ listId: 'l_oa', contactId: 'p_kimura' })).run();
      await insert.bind('attributeDefs', 0, JSON.stringify({ dataSourceId: 'ds_jira', name: 'status' })).run();
      await apply(files[1]!);
      const rows = await d1.prepare('SELECT kind, key FROM master ORDER BY kind').all<{ kind: string; key: string }>();
      expect(rows.results).toEqual([
        { kind: 'attributeDefs', key: 'ds_jira|status' },
        { kind: 'contacts', key: 'p_kimura' },
        { kind: 'listMembers', key: 'l_oa|p_kimura' },
      ]);
      expect((await d1.prepare('SELECT COUNT(*) AS n FROM master_changes').first<{ n: number }>())!.n).toBe(0);
    } finally {
      await mf.dispose();
    }
  });
});
