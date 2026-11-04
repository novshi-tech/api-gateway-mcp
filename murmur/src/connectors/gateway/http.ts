// ゲートウェイへの HTTP。Worker ではゲートウェイの Service Binding（デフォルトの入口）があればそれを使い、なければ公開 URL へ fetch する。
// URL はどちらもゲートウェイの公開 URL のまま渡す（ゲートウェイの OAuth はその URL を発行者として扱う）。

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export { GatewayAuthError, GatewayError } from '../../ports/gateway';

export const USER_AGENT = 'murmur';

export function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
