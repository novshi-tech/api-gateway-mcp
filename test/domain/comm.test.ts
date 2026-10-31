import { describe, expect, it } from 'vitest';
import { deriveComm, type AddressRef, type ThreadLogEntry } from '../../src/domain';

// 通信状態の導出（0030）。ボールはアドレスだけで畳む（どちら側かは決めない。sides.test.ts）

const at = (h: number) => `2026-10-16T${String(h).padStart(2, '0')}:00:00.000Z`;
const US: AddressRef = { channel: 'email', value: 'support@ubs.example' };
const CAROL: AddressRef = { channel: 'email', value: 'carol@example.com' };
const DAVE: AddressRef = { channel: 'email', value: 'info@dave.example' };
let seq = 0;
const signal = (h: number, from: AddressRef, to: AddressRef[], needsResponse: boolean | null = true, replyExpectedBy?: string): ThreadLogEntry => ({
  seq: ++seq,
  at: at(h),
  kind: 'signal',
  signalId: `sig${seq}`,
  from,
  to,
  needsResponse,
  replyExpectedBy,
});
/** 相手（Carol）から support@ へ */
const fromCarol = (h: number, needsResponse: boolean | null = true) => signal(h, CAROL, [US], needsResponse);
/** support@ から Carol へ（こちらからのシグナルは判断しない = null） */
const toCarol = (h: number, replyExpectedBy?: string) => signal(h, US, [CAROL], null, replyExpectedBy);
const dismissed = (h: number): ThreadLogEntry => ({ seq: ++seq, at: at(h), kind: 'dismissed', reason: 'r' });
const reopened = (h: number): ThreadLogEntry => ({ seq: ++seq, at: at(h), kind: 'reopened' });
const claimed = (h: number, userId: string | null): ThreadLogEntry => ({ seq: ++seq, at: at(h), kind: 'claimed', userId });
const other = (h: number, kind: 'note' | 'linked' | 'attribute'): ThreadLogEntry => ({ seq: ++seq, at: at(h), kind });

const holders = (s: ReturnType<typeof deriveComm>) => (s.ball.kind === 'request' ? s.ball.request.holders : null);
const requestedBy = (s: ReturnType<typeof deriveComm>) => (s.ball.kind === 'request' ? s.ball.request.requestedBy : null);

describe('deriveComm（H2・H8）', () => {
  it('空ならボールはなし', () => {
    expect(deriveComm([])).toMatchObject({ ball: { kind: 'none' }, request: null, dismissed: false });
  });

  it('求めるシグナル → 保持者はその宛先、求めた人は送り主。未判断（null）も求めている側に倒す', () => {
    const a = deriveComm([fromCarol(9)]);
    expect(holders(a)).toEqual([US]);
    expect(requestedBy(a)).toEqual(CAROL);
    const b = deriveComm([fromCarol(9), toCarol(10)]);
    expect(holders(b)).toEqual([CAROL]);
    expect(requestedBy(b)).toEqual(US);
    expect(deriveComm([fromCarol(9, null)]).ball.kind).toBe('request');
  });

  it('求めないシグナル: 求めた人以外からなら応えたとみなして空、求めた人（追伸・お礼）からなら変えない', () => {
    expect(deriveComm([fromCarol(9), toCarol(10), fromCarol(11, false)]).ball).toEqual({ kind: 'none' });
    const s = deriveComm([fromCarol(9), fromCarol(10, false)]);
    expect(holders(s)).toEqual([US]);
    expect(deriveComm([fromCarol(9, false)]).ball).toEqual({ kind: 'none' });
    // 別のアドレス（相手側の別の人）の一言でも空になる（0030 の分かっている代償）
    expect(deriveComm([fromCarol(9), signal(10, DAVE, [US], false)]).ball).toEqual({ kind: 'none' });
  });

  it('宛先がなければ（グループのチャネル）「送り主以外」が持つ', () => {
    const s = deriveComm([signal(9, CAROL, [])]);
    expect(s.ball).toMatchObject({ kind: 'request', request: { holders: [], except: CAROL, requestedBy: CAROL } });
  });

  it('since は同じ送り主が求め続けているあいだの最初の時刻', () => {
    expect(deriveComm([fromCarol(9), fromCarol(10)]).request?.since).toBe(at(9));
    expect(deriveComm([fromCarol(9), toCarol(10), fromCarol(11)]).request?.since).toBe(at(11));
  });

  it('時刻順に畳む（同時刻は seq 順）。入力の並びには依存しない', () => {
    const xs = [fromCarol(9), toCarol(10), fromCarol(11, false)];
    expect(deriveComm([...xs].reverse())).toEqual(deriveComm(xs));
  });

  it('片付けたら開き直すまで「なし」。間のシグナルは activeSinceDismissed で知らせ、開き直すとそこから決まる', () => {
    const xs = [fromCarol(9), dismissed(10)];
    expect(deriveComm(xs)).toMatchObject({ ball: { kind: 'none' }, dismissed: true, dismissedAt: at(10), activeSinceDismissed: false });
    const later = [...xs, toCarol(11)];
    expect(deriveComm(later)).toMatchObject({ ball: { kind: 'none' }, activeSinceDismissed: true });
    expect(holders(deriveComm([...later, reopened(12)]))).toEqual([CAROL]);
  });

  it('H4 持つとボールはその人へ。その後の求めるシグナルで保持者に移る。手放すとこちら', () => {
    expect(deriveComm([fromCarol(9), claimed(10, 'u_alice')])).toMatchObject({ ball: { kind: 'claimed', userId: 'u_alice' }, ownerUserId: 'u_alice' });
    const xs = [fromCarol(9), claimed(10, 'u_alice'), toCarol(11)];
    expect(holders(deriveComm(xs))).toEqual([CAROL]);
    expect(deriveComm([...xs, fromCarol(12)])).toMatchObject({ ownerUserId: 'u_alice', ball: { kind: 'request' } });
    expect(deriveComm([...xs, fromCarol(12), claimed(13, null)])).toMatchObject({ ball: { kind: 'claimed', userId: null }, ownerUserId: null });
    // 持っても、最後に求めたシグナルは残る（クエリ層の未応答に使う）
    expect(deriveComm([fromCarol(9), claimed(10, 'u_alice')]).request?.since).toBe(at(9));
    expect(deriveComm([fromCarol(9), dismissed(10), claimed(11, 'u_alice')])).toMatchObject({ ball: { kind: 'none' }, ownerUserId: 'u_alice' });
  });

  it('H4 返事期待は記録した送信から。その送り主以外からシグナルが来れば消える', () => {
    const xs = [fromCarol(9), toCarol(10, at(20))];
    expect(deriveComm(xs)).toMatchObject({ replyExpectedBy: at(20), replyExpectedFrom: US });
    expect(deriveComm([...xs, fromCarol(11, false)])).toMatchObject({ replyExpectedBy: null, replyExpectedFrom: null });
    expect(deriveComm([...xs, toCarol(11)]).replyExpectedBy).toBe(at(20));
  });

  it('H2 メモ・リンク・属性はボールを動かさない', () => {
    expect(deriveComm([other(9, 'note'), other(10, 'linked'), other(11, 'attribute')])).toEqual(deriveComm([]));
    expect(holders(deriveComm([fromCarol(9), toCarol(10), other(11, 'linked')]))).toEqual([CAROL]);
  });
});
