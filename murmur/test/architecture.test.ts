import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// FC-IS の境界をテストで縛る: src/domain（関数型コア）は IO に依存しない。

const DOMAIN = join(import.meta.dirname, '../src/domain');
const files = readdirSync(DOMAIN).filter((f) => f.endsWith('.ts'));

describe('関数型コア（src/domain）の純粋性', () => {
  it.each(files)('%s は zod と domain 内のモジュールしか import しない', (file) => {
    const src = readFileSync(join(DOMAIN, file), 'utf8');
    const imports = [...src.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]!);
    for (const spec of imports) expect(spec === 'zod' || spec.startsWith('./')).toBe(true);
  });

  it.each(files)('%s は時計・乱数・ネットワーク・Workers API を使わない', (file) => {
    const src = readFileSync(join(DOMAIN, file), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const banned of [/Date\.now\(/, /new Date\(\)/, /Math\.random\(/, /crypto\./, /\bfetch\(/, /\bprocess\./, /\bconsole\./, /\benv\./]) {
      expect(src).not.toMatch(banned);
    }
  });
});

// vertical slice（0023 の決定 7）: ゲートウェイと 1 つの Worker になっても、Murmur のコードが
// ゲートウェイの実装・秘密・グローバルに直に触れないことを縛る。1 つの Worker にする前（段取り 2）から守る。

const SRC = join(import.meta.dirname, '../src');

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );
}

const sources = walk(SRC).map((path) => ({
  path,
  rel: path.slice(SRC.length + 1),
  code: readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1'),
}));
const importsOf = (code: string) => [...code.matchAll(/(?:from|import)\s+'([^']+)'/g)].map((m) => m[1]!);
const ENTRY = 'index.ts';

describe('vertical slice（0023 の決定 7）', () => {
  it('ゲートウェイの口の実装（connectors/gateway/）を import してよいのは、入口と口の実装自身だけ。ほかは ports/gateway.ts を使う', () => {
    const offenders = sources
      .filter((s) => s.rel !== ENTRY && !s.rel.startsWith('connectors/gateway/'))
      .filter((s) => importsOf(s.code).some((spec) => /connectors\/gateway\/|^\.\.?\/gateway\/|^\.\/(client|oauth|remote|http)$/.test(spec) && !spec.includes('ports/')))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('ports/ は型と取り決めだけ（何も import しない）', () => {
    for (const s of sources.filter((s) => s.rel.startsWith('ports/'))) expect(importsOf(s.code)).toEqual([]);
  });

  it('env と cloudflare:workers に触れてよいのは入口だけ（秘密は入口が必要な分だけ渡す）', () => {
    const offenders = sources
      .filter((s) => s.rel !== ENTRY)
      .filter((s) => /\benv\.[A-Z_]+/.test(s.code) || importsOf(s.code).includes('cloudflare:workers'))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });

  it('実行時の依存は許可リストだけ（Murmur は依存を足さない）', () => {
    const allowed = /^(zod|drizzle-orm(\/[\w-]+)?)$/;
    const bare = sources.flatMap((s) => importsOf(s.code).filter((spec) => !spec.startsWith('.')).map((spec) => `${s.rel}: ${spec}`));
    expect(bare.filter((x) => !allowed.test(x.split(': ')[1]!))).toEqual([]);
  });

  it('グローバル（globalThis・fetch・crypto）を書き換えない', () => {
    const offenders = sources
      .filter((s) => /globalThis\s*(\.\w+|\[[^\]]+\])\s*=[^=]|(^|[^.\w])(fetch|crypto)\s*=[^=]|Object\.defineProperty\(\s*globalThis/m.test(s.code))
      .map((s) => s.rel);
    expect(offenders).toEqual([]);
  });
});
