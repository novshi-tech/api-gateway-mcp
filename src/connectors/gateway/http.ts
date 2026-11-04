// ゲートウェイへの HTTP。Worker ではゲートウェイの Service Binding（デフォルトの入口）があればそれを使い、なければ公開 URL へ fetch する。
// URL はどちらもゲートウェイの公開 URL のまま渡す（ゲートウェイの OAuth はその URL を発行者として扱う）。

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

/** ゲートウェイの外の資格情報の問題（同意の取り消し・つなぎ直しが必要）。データソースを broken にする */
export class GatewayAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GatewayAuthError';
  }
}

/** 一時的な失敗（試し直せば通るかもしれない） */
export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GatewayError';
  }
}

export const USER_AGENT = 'murmur';

export function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
