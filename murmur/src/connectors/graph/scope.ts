import type { ReadScope } from '../../ports/gateway';

/**
 * 本体が Graph に対して呼べる口（0024 の決定 1、0023 の決定 4）。読み取りは本人の箱（/me の下）だけ、
 * 書き込み系はサブスクリプションの作成・延長・削除だけ。メールの送信・下書き・移動などの口はない。
 * 組み立て時にゲートウェイの口の実装に渡し、ここにない呼び出しは送る前に断る
 */
export const GRAPH_SCOPE: ReadScope = Object.freeze([
  ['GET', /^\/v1\.0\/me([/?].*)?$/],
  ['POST', /^\/v1\.0\/subscriptions$/],
  ['PATCH', /^\/v1\.0\/subscriptions\/[^/?]+$/],
  ['DELETE', /^\/v1\.0\/subscriptions\/[^/?]+$/],
] as const);
