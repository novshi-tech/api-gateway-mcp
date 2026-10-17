import type { Seed } from '../../src/domain/entities';

/**
 * seed の User ID を付け替える（仮の u_xxx → ゲートウェイの User ID）。
 * users[].id と、それを指す文字列（parties[].userId、listMembers など）を同じ値で置き換える
 */
export function renameUsers(seed: Seed, map: Record<string, string>): Seed {
  const known = new Set(seed.users.map((u) => u.id));
  for (const from of Object.keys(map)) {
    if (!known.has(from)) throw new Error(`seed に User ${from} がない（あるのは ${[...known].join(', ')}）`);
  }
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return Object.hasOwn(map, v) ? map[v] : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(seed) as Seed;
}

/** `--user u_kimura=entra_...` の並びを読む */
export function parseUserMap(args: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== '--user') continue;
    const [from, to] = (args[i + 1] ?? '').split('=');
    if (!from || !to) throw new Error('--user は <seed の User ID>=<ゲートウェイの User ID>');
    map[from] = to;
  }
  return map;
}
