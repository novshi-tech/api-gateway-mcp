import { z } from 'zod';

// マスタ（イベントではない）。seed.json と DB のマスタテーブルが同じ形を持つ。

export const Channel = z.enum(['email', 'slack', 'line', 'jira', 'bitbucket', 'internal']);
export type Channel = z.infer<typeof Channel>;

/** 取得・送信に使った資格情報の主体。取得主体ルールの入力になる */
export const Principal = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user'), userId: z.string() }),
  z.object({ kind: z.literal('organization'), tenantId: z.string() }),
]);
export type Principal = z.infer<typeof Principal>;

export const Tenant = z.object({ id: z.string(), name: z.string() });
export type Tenant = z.infer<typeof Tenant>;

/** ゲートウェイの User と 1:1 */
export const User = z.object({ id: z.string(), name: z.string() });
export type User = z.infer<typeof User>;

/**
 * 人物／組織。internal = 自分側（自社とその社員）。
 * userId を持たない Party がゴースト。
 */
export const Party = z.object({
  id: z.string(),
  tenantId: z.string(),
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
  tenantId: z.string(),
  channel: Channel,
  value: z.string(),
  partyId: z.string(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
});
export type Address = z.infer<typeof Address>;

export const List = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  description: z.string().default(''),
});
export type List = z.infer<typeof List>;

export const ListMember = z.object({ listId: z.string(), partyId: z.string() });
export type ListMember = z.infer<typeof ListMember>;

export const AttributeType = z.enum(['string', 'number', 'boolean', 'date', 'enum', 'party']);
export const AttributeDef = z.object({
  listId: z.string(),
  name: z.string(),
  type: AttributeType,
  /** enum の選択肢 */
  options: z.array(z.string()).optional(),
  /** AI が読む意味の記述（必須） */
  description: z.string().min(1),
});
export type AttributeDef = z.infer<typeof AttributeDef>;

export const CredentialRef = z.object({
  id: z.string(),
  tenantId: z.string(),
  principal: Principal,
  addressId: z.string(),
  /** ゲートウェイ側の資格情報の識別子（プロトでは未使用） */
  gatewayCredentialId: z.string().optional(),
});
export type CredentialRef = z.infer<typeof CredentialRef>;

/** Organization 主体で取得したシグナルを置いてよいリスト（チャネルごと） */
export const ChannelPolicy = z.object({
  tenantId: z.string(),
  channel: Channel,
  allowedListIds: z.array(z.string()),
});
export type ChannelPolicy = z.infer<typeof ChannelPolicy>;

export const Seed = z.object({
  tenants: z.array(Tenant),
  users: z.array(User),
  parties: z.array(Party),
  addresses: z.array(Address),
  lists: z.array(List),
  listMembers: z.array(ListMember),
  attributeDefs: z.array(AttributeDef),
  credentialRefs: z.array(CredentialRef).default([]),
  channelPolicies: z.array(ChannelPolicy).default([]),
});
export type Seed = z.infer<typeof Seed>;
export type SeedInput = z.input<typeof Seed>;
