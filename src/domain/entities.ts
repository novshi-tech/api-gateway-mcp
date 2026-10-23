import { z } from 'zod';

// マスタ（イベントではない）。seed.json と DB のマスタテーブルが同じ形を持つ。
// 1 デプロイ = 1 チームなので、テナントのキーは持たない（0020・0021）。

/** note = 個人のメモ（0014）。それ以外は外のサービス */
export const Channel = z.enum(['email', 'slack', 'line', 'jira', 'bitbucket', 'note']);
export type Channel = z.infer<typeof Channel>;

/** 資格情報の主体 */
export const Principal = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), userId: z.string() }),
  /** 組織（このデプロイのチーム、0020・0021） */
  z.object({ kind: z.literal('organization') }),
]);
export type Principal = z.infer<typeof Principal>;

/** ゲートウェイの User と 1:1。このデプロイ（チーム）の Party は 1 つまで */
export const User = z.object({ id: z.string(), name: z.string() });
export type User = z.infer<typeof User>;

/**
 * 人物／組織。internal = 自分側（自社とその社員）。
 * userId を持たない Party がゴースト。
 */
export const Party = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['person', 'organization']),
  userId: z.string().optional(),
  internal: z.boolean().default(false),
  /** 外部マスタ（bm-next・board・freee など）へのポインタの束 */
  externalRefs: z.record(z.string(), z.string()).default({}),
});
export type Party = z.infer<typeof Party>;

export const Address = z.object({
  id: z.string(),
  channel: Channel,
  value: z.string(),
  partyId: z.string(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
});
export type Address = z.infer<typeof Address>;

export const CredentialRef = z.object({
  id: z.string(),
  principal: Principal,
  addressId: z.string(),
  /** ゲートウェイ側の資格情報の識別子（プロトでは未使用） */
  gatewayCredentialId: z.string().optional(),
});
export type CredentialRef = z.infer<typeof CredentialRef>;

/**
 * データソース（0014）。リスト 1 つに対応する。
 * - service: 外のサービス（メールボックス、Slack のチャネルや DM、LINE 公式アカウント、Jira のプロジェクト）。
 *   資格情報で取り込み、selfAddressIds（送信元のアドレス = こちら）で受信と観測された送信を分ける
 * - notes: 個人のメモ。ユーザーごとに 1 つ、読者は本人だけ
 */
export const DataSource = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('service'),
    id: z.string(),
    channel: Channel.exclude(['note']),
    name: z.string(),
    description: z.string().default(''),
    credentialRefId: z.string(),
    selfAddressIds: z.array(z.string()).min(1),
    /** グループのチャネル。区切りの「同じ相手」がチャネルになる */
    group: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('notes'),
    id: z.string(),
    name: z.string(),
    description: z.string().default(''),
    ownerPartyId: z.string(),
  }),
]);
export type DataSource = z.infer<typeof DataSource>;
export type ServiceDataSource = Extract<DataSource, { kind: 'service' }>;

/** データソース 1 つに 1 つ。可視性の単位 */
export const List = z.object({ id: z.string(), dataSourceId: z.string() });
export type List = z.infer<typeof List>;

/** リストの読者 */
export const ListMember = z.object({ listId: z.string(), partyId: z.string() });
export type ListMember = z.infer<typeof ListMember>;

export const AttributeType = z.enum(['string', 'number', 'boolean', 'date', 'enum', 'party']);
/** 本人が付ける属性の定義。データソースに付く（ステップ 3 で使う） */
export const AttributeDef = z.object({
  dataSourceId: z.string(),
  name: z.string(),
  type: AttributeType,
  /** enum の選択肢 */
  options: z.array(z.string()).optional(),
  /** AI が読む意味の記述（必須） */
  description: z.string().min(1),
});
export type AttributeDef = z.infer<typeof AttributeDef>;

export const Seed = z.object({
  users: z.array(User),
  parties: z.array(Party),
  addresses: z.array(Address),
  credentialRefs: z.array(CredentialRef).default([]),
  dataSources: z.array(DataSource).default([]),
  lists: z.array(List).default([]),
  listMembers: z.array(ListMember).default([]),
  attributeDefs: z.array(AttributeDef).default([]),
});
export type Seed = z.infer<typeof Seed>;
export type SeedInput = z.input<typeof Seed>;
