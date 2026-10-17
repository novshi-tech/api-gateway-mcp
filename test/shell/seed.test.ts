import { describe, expect, it } from 'vitest';
import { loadScenario } from '../../scripts/lib/scenario';
import { parseUserMap, renameUsers } from '../../scripts/lib/seed';

describe('H7 seed の投入（User ID の付け替え）', () => {
  it('H7 users と、それを指す Party・リストのメンバーが同じ ID に付け替わる', () => {
    const seed = loadScenario('absence').seed;
    const out = renameUsers(seed, parseUserMap(['--user', 'u_kimura=entra_t_o']));
    expect(out.users.map((u) => u.id)).toEqual(['entra_t_o']);
    expect(out.parties.find((p) => p.id === 'p_kimura')?.userId).toBe('entra_t_o');
    expect(JSON.stringify(out)).not.toContain('u_kimura');
    expect(JSON.stringify(seed)).toContain('u_kimura');
  });

  it('H7 seed にない User を指定したら失敗する', () => {
    expect(() => renameUsers(loadScenario('absence').seed, { u_nobody: 'x' })).toThrow(/u_nobody/);
  });
});
