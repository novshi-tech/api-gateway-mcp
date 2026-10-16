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
