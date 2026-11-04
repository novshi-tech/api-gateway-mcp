// シェルの暗号の部品（WebCrypto）。ゲートウェイのリフレッシュトークンの暗号化と、clientState・state の乱数とハッシュ。

const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomHex(bytes = 32): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text)));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function base64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

/** PKCE の S256 */
export async function s256(verifier: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier))));
}

/** AES-GCM で包む。鍵は 32 バイトを base64 にしたシークレット（TOKEN_KEY） */
export class SecretBox {
  private constructor(private readonly key: CryptoKey) {}

  static async fromBase64(secret: string): Promise<SecretBox> {
    const raw = fromBase64(secret);
    if (raw.length !== 32) throw new Error('TOKEN_KEY must be 32 bytes in base64');
    return new SecretBox(await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']));
  }

  async seal(plain: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, enc.encode(plain)));
    return `${base64Url(iv)}.${base64Url(sealed)}`;
  }

  async open(box: string): Promise<string> {
    const [iv, data] = box.split('.');
    if (!iv || !data) throw new Error('malformed sealed value');
    return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, this.key, fromBase64(data)));
  }
}
