import type { CoreContext } from './context';
import { sameValue } from './directory';
import type { DataSource, Seed, ServiceDataSource } from './entities';
import { DomainError } from './errors';
import { bindIdentity, createPersonalDataSource, type IdentityOutcome } from './people';

// 実行時のデータソースの作成（0024 の決定 3）。個人の箱は本人がゲートウェイの OAuth で本体に同意したあとに作る。
// 作り方は 0030 の個人のリスト（createPersonalDataSource）と同じ: 読者は本人だけ、窓口のアドレスは持たず、
// メールボックスのアドレスが本人の Contact に付いて「こちら」になる。マスタの書き換えはシェルの changeMaster が記録に残す。

export interface MailboxInput {
  userId: string;
  /** ゲートウェイの資格情報（本人の graph の接続）の ID */
  gatewayCredentialId: string;
  /** メールボックスの持ち主の表示名（データソースの名前に使う） */
  displayName: string;
  /** 本人のアドレスとエイリアス。先頭が主のアドレスで、リストでのアイデンティティになる */
  addresses: string[];
}

export type MailboxPlan =
  | { kind: 'exists'; dataSource: ServiceDataSource }
  | { kind: 'created'; dataSource: ServiceDataSource; identity: IdentityOutcome };

/**
 * 同じ本人・同じゲートウェイの接続のメールボックスがあればそれを返し、なければマスタの下書き（draft）に作る。
 * エイリアスも本人の Contact に付ける（別の人のアドレスなら conflict）
 */
export function connectMailbox(draft: Seed, ctx: CoreContext, input: MailboxInput): MailboxPlan {
  const user = draft.users.find((u) => u.id === input.userId);
  if (!user) throw new DomainError('forbidden', `user ${input.userId} はまだサインインしていない`);

  const existing = draft.dataSources.find((ds): ds is ServiceDataSource => {
    if (ds.kind !== 'service' || ds.connector?.kind !== 'graph-mail') return false;
    const cred = draft.credentialRefs.find((c) => c.id === ds.credentialRefId);
    return cred?.principal.kind === 'user' && cred.principal.userId === input.userId && cred.gatewayCredentialId === input.gatewayCredentialId;
  });
  if (existing) return { kind: 'exists', dataSource: existing };

  const values = dedupe(input.addresses.map((a) => a.trim()).filter((a) => a.includes('@')));
  if (values.length === 0) throw new DomainError('invalid', 'メールボックスのアドレスがわからない');
  const name = input.displayName || user.name || values[0]!;

  const created = createPersonalDataSource(
    draft,
    input.userId,
    {
      channel: 'email',
      name: `${name} の Outlook`,
      description: `${name} の個人のメールボックス。本人の同意で取り込む（読者は本人だけ）`,
      identity: values[0]!,
      gatewayCredentialId: input.gatewayCredentialId,
    },
    ctx,
  );
  for (const alias of values.slice(1)) bindIdentity(draft, input.userId, { channel: 'email', value: alias }, ctx);
  const dataSource = draft.dataSources.find((d) => d.id === created.dataSourceId) as ServiceDataSource;
  dataSource.connector = { kind: 'graph-mail', mailbox: 'me', folders: ['inbox', 'sentitems'] };
  return { kind: 'created', dataSource, identity: created.identity };
}

/** 実行時に作ったメールボックスのデータソースの持ち主（個人の資格情報の本人） */
export function connectorOwner(seed: Seed, ds: DataSource): string | null {
  if (ds.kind !== 'service') return null;
  const cred = seed.credentialRefs.find((c) => c.id === ds.credentialRefId);
  return cred?.principal.kind === 'user' ? cred.principal.userId : null;
}

function dedupe(values: string[]): string[] {
  const out: string[] = [];
  for (const v of values) if (!out.some((o) => sameValue(o, v))) out.push(v);
  return out;
}
