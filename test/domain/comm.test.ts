import { describe, expect, it } from 'vitest';
import { deriveComm, sortTimeline, type TimelineEntry } from '../../src/domain';

const e = (seq: number, at: string, kind: TimelineEntry['kind'], extra: Partial<TimelineEntry> = {}): TimelineEntry => ({
  taskId: 't',
  seq,
  at,
  kind,
  ...extra,
});

describe('H2 deriveComm: 通信状態は事前定義の項目だけから導出される', () => {
  it('空のタスクはボールが自リストにあり、未応答なし', () => {
    expect(deriveComm('l1', [])).toEqual({
      ballAt: { kind: 'list', listId: 'l1' },
      lastInboundAt: null,
      lastOutboundAt: null,
      replyExpectedBy: null,
      unansweredSince: null,
      overdue: false,
    });
  });

  it('受信でボールは自リスト、未応答は最初の受信から数える', () => {
    const c = deriveComm('l1', [e(1, '2026-10-01T00:00:00Z', 'inbound'), e(2, '2026-10-02T00:00:00Z', 'inbound')]);
    expect(c.ballAt).toEqual({ kind: 'list', listId: 'l1' });
    expect(c.unansweredSince).toBe('2026-10-01T00:00:00Z');
    expect(c.lastInboundAt).toBe('2026-10-02T00:00:00Z');
  });

  it('送信でボールは宛先 Party に移り、未応答が消え、返事期待が入る', () => {
    const c = deriveComm('l1', [
      e(1, '2026-10-01T00:00:00Z', 'inbound'),
      e(2, '2026-10-01T01:00:00Z', 'outbound', { toPartyIds: ['p1'], replyExpectedBy: '2026-10-03T00:00:00Z' }),
    ]);
    expect(c.ballAt).toEqual({ kind: 'party', partyIds: ['p1'] });
    expect(c.unansweredSince).toBeNull();
    expect(c.replyExpectedBy).toBe('2026-10-03T00:00:00Z');
    expect(c.lastOutboundAt).toBe('2026-10-01T01:00:00Z');
  });

  it('派生を出すとボールは派生先リストへ、返事で戻る', () => {
    const out = [e(1, '2026-10-01T00:00:00Z', 'derivation_out', { targetListId: 'l2', replyExpectedBy: '2026-10-05T00:00:00Z' })];
    expect(deriveComm('l1', out).ballAt).toEqual({ kind: 'list', listId: 'l2' });
    const back = deriveComm('l1', [...out, e(2, '2026-10-02T00:00:00Z', 'derivation_replied')]);
    expect(back.ballAt).toEqual({ kind: 'list', listId: 'l1' });
    expect(back.replyExpectedBy).toBeNull();
    expect(back.unansweredSince).toBe('2026-10-02T00:00:00Z');
  });

  it('内部派生を受けたタスクはボールが自リスト、外部派生の適用先は宛先 Party', () => {
    expect(deriveComm('l2', [e(1, '2026-10-01T00:00:00Z', 'derivation_in')]).ballAt).toEqual({ kind: 'list', listId: 'l2' });
    expect(deriveComm('l2', [e(1, '2026-10-01T00:00:00Z', 'derivation_in', { toPartyIds: ['p9'] })]).ballAt).toEqual({
      kind: 'party',
      partyIds: ['p9'],
    });
  });

  it('期限超過は終端ではなく、遅れて返事が来れば消える', () => {
    const base = [e(1, '2026-10-01T00:00:00Z', 'derivation_out', { targetListId: 'l2' }), e(2, '2026-10-03T00:00:00Z', 'reply_overdue')];
    expect(deriveComm('l1', base).overdue).toBe(true);
    expect(deriveComm('l1', [...base, e(3, '2026-10-04T00:00:00Z', 'derivation_replied')]).overdue).toBe(false);
  });

  it('カスタム属性・open/closed は通信状態に影響しない', () => {
    const base = [e(1, '2026-10-01T00:00:00Z', 'inbound')];
    const noisy = [
      ...base,
      e(2, '2026-10-02T00:00:00Z', 'attribute_set', { attribute: { name: 'status', value: 'done' } }),
      e(3, '2026-10-02T00:00:00Z', 'closed'),
      e(4, '2026-10-03T00:00:00Z', 'reopened'),
    ];
    expect(deriveComm('l1', noisy)).toEqual(deriveComm('l1', base));
  });

  it('入力の順序ではなく時刻（同時刻は seq）順に畳み込む', () => {
    const a = e(2, '2026-10-01T00:00:00Z', 'inbound');
    const b = e(1, '2026-10-02T00:00:00Z', 'outbound', { toPartyIds: ['p1'] });
    expect(deriveComm('l1', [b, a])).toEqual(deriveComm('l1', [a, b]));
    expect(sortTimeline([e(5, 'x', 'inbound'), e(3, 'x', 'inbound')]).map((x) => x.seq)).toEqual([3, 5]);
  });
});
