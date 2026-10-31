import { z } from 'zod';

// マスタ（イベントではない）。seed.json と DB のマスタテーブルが同じ形を持つ。
// 1 デプロイ = 1 チームなので、テナントのキーは持たない（0020・0021）。

/** note = 個人のメモ（0014）。それ以外は外のサービス */
export const Channel = z.enum(['email', 'slack', 'line', 'jira', 'bitbucket', 'note']);
export type Channel = z.infer<typeof Channel>;

/** チャネルと値だけのアドレス（Contact に属さない。イベント・データソースの窓口・資格情報が持つ） */
export const AddressRef = z.object({ channel: Channel, value: z.string() });
export type AddressRef = z.infer<typeof AddressRef>;

/** 資格情報の主体 */
export const Principal = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), userId: z.string() }),
  /** このデプロイのチーム（0020・0021）。共有のデータソースはチームの資格情報で取る（0013） */
  z.object({ kind: z.literal('team') }),
]);
export type Principal = z.infer<typeof Principal>;

/** ゲートウェイの User と 1:1。このデプロイ（チーム）の Contact は 1 つまで */
export const User = z.object({ id: z.string(), name: z.string() });
export type User = z.infer<typeof User>;

/**
 * 連絡の相手（0030）。アドレスを束ねたもので、人か会社の窓口かボットかは区別しない。
 * 自分も Contact の 1 つで、User に結ばれている。userId を持たない Contact がゴースト。
 */
export const Contact = z.object({
  id: z.string(),
  name: z.string(),
  userId: z.string().optional(),
  /** 外部マスタ（bm-next・board・freee など）へのポインタの束 */
  externalRefs: z.record(z.string(), z.string()).default({}),
});
export type Contact = z.infer<typeof Contact>;

export const Address = z.object({
  id: z.string(),
  channel: Channel,
  value: z.string(),
  contactId: z.string(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
});
export type Address = z.infer<typeof Address>;

export const CredentialRef = z.object({
  id: z.string(),
  principal: Principal,
  /** 資格情報のアカウントのアドレス */
  address: AddressRef,
  /** ゲートウェイ側の資格情報の識別子（プロトでは未使用） */
  gatewayCredentialId: z.string().optional(),
});
export type CredentialRef = z.infer<typeof CredentialRef>;

/**
 * データソース（0014）。リスト 1 つに対応する。
 * - service: 外のサービス（メールボックス、Slack のチャネルや DM、LINE 公式アカウント、Jira のプロジェクト）。
 *   資格情報で取り込み、selfAddresses（窓口のアドレス）と読者の Contact のアドレスが「こちら」（0030。クエリ層の sides.ts）
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
    /** 窓口のアドレス（共有メールボックス・LINE 公式アカウント・Jira のサイトなど）。個人の箱では空でよい */
    selfAddresses: z.array(AddressRef).default([]),
    /** グループのチャネル。区切りの「同じ相手」がチャネルになる */
    group: z.boolean().default(false),
  }),
  z.object({
    kind: z.literal('notes'),
    id: z.string(),
    name: z.string(),
    description: z.string().default(''),
    /** 持ち主の User（0030。読者は本人だけ。Contact がなくても使える） */
    ownerUserId: z.string(),
  }),
]);
export type DataSource = z.infer<typeof DataSource>;
export type ServiceDataSource = Extract<DataSource, { kind: 'service' }>;

/** データソース 1 つに 1 つ。可視性の単位 */
export const List = z.object({ id: z.string(), dataSourceId: z.string() });
export type List = z.infer<typeof List>;

/** リストの読者。見えるかどうかは User で決める（0030。ゴーストが読者になることはない） */
export const ListMember = z.object({ listId: z.string(), userId: z.string() });
export type ListMember = z.infer<typeof ListMember>;

export const AttributeType = z.enum(['string', 'number', 'boolean', 'date', 'enum', 'contact']);
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
  contacts: z.array(Contact),
  addresses: z.array(Address),
  credentialRefs: z.array(CredentialRef).default([]),
  dataSources: z.array(DataSource).default([]),
  lists: z.array(List).default([]),
  listMembers: z.array(ListMember).default([]),
  attributeDefs: z.array(AttributeDef).default([]),
});
export type Seed = z.infer<typeof Seed>;
export type SeedInput = z.input<typeof Seed>;
