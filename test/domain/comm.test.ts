import { describe, expect, it } from 'vitest';
import { deriveComm, type ThreadLogEntry } from '../../src/domain';

// 通信状態の導出（ボール）は、シグナルの向き・「返事や対応を求めているか」・片付けだけから決まる

const at = (h: number) => `2026-10-16T${String(h).padStart(2, '0')}:00:00.000Z`;
let seq = 0;
const inbound = (h: number, needsResponse: boolean | null = true): ThreadLogEntry => ({ seq: ++seq, at: at(h), kind: 'signal', direction: 'inbound', needsResponse });
const outbound = (h: number, toPartyIds = ['p_carol']): ThreadLogEntry => ({ seq: ++seq, at: at(h), kind: 'signal', direction: 'outbound', needsResponse: null, toPartyIds });
const dismissed = (h: number): ThreadLogEntry => ({ seq: ++seq, at: at(h), kind: 'dismissed', reason: 'r' });
const reopened = (h: number): ThreadLogEntry => ({ seq: ++seq, at: at(h), kind: 'reopened' });

describe('deriveComm', () => {
  it('空ならボールはなし', () => {
    expect(deriveComm([])).toMatchObject({ ball: { kind: 'none' }, lastInboundAt: null, lastOutboundAt: null, unansweredSince: null, dismissed: false });
  });

  it('求める受信 → こちら、送信 → 相手、求めない受信 → 相手待ちなら「なし」', () => {
    expect(deriveComm([inbound(9)]).ball).toEqual({ kind: 'us' });
    expect(deriveComm([inbound(9), outbound(10)]).ball).toEqual({ kind: 'party', partyIds: ['p_carol'] });
    expect(deriveComm([inbound(9), outbound(10), inbound(11, false)]).ball).toEqual({ kind: 'none' });
  });

  it('こちらの番のときに求めない受信（スタンプ）が来てもこちらのまま。最初が求めない受信なら「なし」', () => {
    expect(deriveComm([inbound(9), inbound(10, false)])).toMatchObject({ ball: { kind: 'us' }, unansweredSince: at(9), lastInboundAt: at(10) });
    expect(deriveComm([inbound(9, false)]).ball).toEqual({ kind: 'none' });
  });

  it('未判断（null）の受信は求めている側に倒す', () => {
    expect(deriveComm([inbound(9, null)]).ball).toEqual({ kind: 'us' });
  });

  it('未応答は最初の求める受信から、送信で消える', () => {
    expect(deriveComm([inbound(9), inbound(10)]).unansweredSince).toBe(at(9));
    expect(deriveComm([inbound(9), outbound(10), inbound(11)]).unansweredSince).toBe(at(11));
    expect(deriveComm([inbound(9), outbound(10)]).unansweredSince).toBeNull();
  });

  it('時刻順に畳む（同時刻は seq 順）。入力の並びには依存しない', () => {
    const xs = [inbound(9), outbound(10), inbound(11, false)];
    expect(deriveComm([...xs].reverse())).toEqual(deriveComm(xs));
  });

  it('片付けたら開き直すまで「なし」。間のシグナルは activeSinceDismissed で知らせ、開き直すとそこから決まる', () => {
    const xs = [inbound(9), dismissed(10)];
    expect(deriveComm(xs)).toMatchObject({ ball: { kind: 'none' }, dismissed: true, dismissedAt: at(10), activeSinceDismissed: false });
    const later = [...xs, outbound(11)];
    expect(deriveComm(later)).toMatchObject({ ball: { kind: 'none' }, activeSinceDismissed: true, lastOutboundAt: at(11) });
    expect(deriveComm([...later, reopened(12)])).toMatchObject({ ball: { kind: 'party', partyIds: ['p_carol'] }, dismissed: false });
  });
});
