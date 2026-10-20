import type { Address, AttributeDef, Channel, DataSource, List, Party, Seed } from './entities';
import type { AddressRef } from './events';

/**
 * マスタの読み取り専用ビュー。純粋な検索だけを持つ。
 * シェルは DB か seed.json からマスタを読み、これに包んでコアへ渡す。
 */
export class Directory {
  constructor(readonly seed: Seed) {}

  tenantIds(): string[] {
    return this.seed.tenants.map((t) => t.id);
  }

  party(partyId: string): Party | undefined {
    return this.seed.parties.find((p) => p.id === partyId);
  }

  dataSource(dataSourceId: string): DataSource | undefined {
    return this.seed.dataSources.find((d) => d.id === dataSourceId);
  }

  dataSourcesOfTenant(tenantId: string): DataSource[] {
    return this.seed.dataSources.filter((d) => d.tenantId === tenantId);
  }

  list(listId: string): List | undefined {
    return this.seed.lists.find((l) => l.id === listId);
  }

  listOfDataSource(dataSourceId: string): List | undefined {
    return this.seed.lists.find((l) => l.dataSourceId === dataSourceId);
  }

  /** User の各テナントでの Party。ゴースト Party は User を持たないので出てこない */
  partiesOfUser(userId: string): Party[] {
    return this.seed.parties.filter((p) => p.userId === userId);
  }

  listIdsOfParty(partyId: string): string[] {
    return this.seed.listMembers.filter((m) => m.partyId === partyId).map((m) => m.listId);
  }

  readersOfList(listId: string): Party[] {
    const ids = new Set(this.seed.listMembers.filter((m) => m.listId === listId).map((m) => m.partyId));
    return this.seed.parties.filter((p) => ids.has(p.id));
  }

  attributeDefs(dataSourceId: string): AttributeDef[] {
    return this.seed.attributeDefs.filter((d) => d.dataSourceId === dataSourceId);
  }

  address(addressId: string): Address | undefined {
    return this.seed.addresses.find((a) => a.id === addressId);
  }

  /** at 時点で有効な Address を引く。期間付きの紐づけに対応する */
  findAddress(tenantId: string, ref: AddressRef, at?: string): Address | undefined {
    return this.seed.addresses.find(
      (a) =>
        a.tenantId === tenantId &&
        a.channel === ref.channel &&
        sameValue(a.value, ref.value) &&
        isValidAt(a, at),
    );
  }

  partyIdOfAddress(tenantId: string, ref: AddressRef, at?: string): string | null {
    return this.findAddress(tenantId, ref, at)?.partyId ?? null;
  }

  addressesOfParty(partyId: string, channel?: Channel, at?: string): Address[] {
    return this.seed.addresses.filter(
      (a) => a.partyId === partyId && (channel === undefined || a.channel === channel) && isValidAt(a, at),
    );
  }

  /** データソースの送信元（こちら）のアドレスか。シグナルの direction を機械的に決める */
  isSelfAddress(ds: DataSource, ref: AddressRef): boolean {
    if (ds.kind !== 'service') return false;
    return ds.selfAddressIds.some((id) => {
      const a = this.address(id);
      return a !== undefined && a.channel === ref.channel && sameValue(a.value, ref.value);
    });
  }
}

export function sameValue(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function isValidAt(a: Address, at?: string): boolean {
  if (!at) return true;
  if (a.validFrom && at < a.validFrom) return false;
  if (a.validTo && at >= a.validTo) return false;
  return true;
}

/**
 * マスタの整合性（H3 の前提）。問題の一覧を返す（空なら整合している）。
 * - データソース 1 つにリスト 1 つ
 * - 個人のメモのリストの読者は本人だけ
 * - 個人の資格情報は読者 1 人（その本人）のデータソースにしか使わない。共有のデータソースは組織の資格情報（0013）
 */
export function seedProblems(seed: Seed): string[] {
  const dir = new Directory(seed);
  const problems: string[] = [];
  const tenants = new Set(seed.tenants.map((t) => t.id));
  for (const ds of seed.dataSources) {
    if (!tenants.has(ds.tenantId)) problems.push(`data source ${ds.id}: tenant ${ds.tenantId} がない`);
    const lists = seed.lists.filter((l) => l.dataSourceId === ds.id);
    if (lists.length !== 1) {
      problems.push(`data source ${ds.id}: リストが ${lists.length} 個（1 個のはず）`);
      continue;
    }
    const list = lists[0]!;
    if (list.tenantId !== ds.tenantId) problems.push(`list ${list.id}: data source とテナントが違う`);
    const readers = dir.readersOfList(list.id);
    for (const r of readers) {
      if (r.tenantId !== ds.tenantId) problems.push(`list ${list.id}: 読者 ${r.id} が別テナント`);
      if (!r.userId) problems.push(`list ${list.id}: 読者 ${r.id} がゴースト（User を持たない）`);
    }
    if (ds.kind === 'notes') {
      if (readers.length !== 1 || readers[0]!.id !== ds.ownerPartyId) {
        problems.push(`data source ${ds.id}: 個人のメモの読者は本人（${ds.ownerPartyId}）だけ`);
      }
      continue;
    }
    const cred = seed.credentialRefs.find((c) => c.id === ds.credentialRefId);
    if (!cred || cred.tenantId !== ds.tenantId) {
      problems.push(`data source ${ds.id}: 資格情報 ${ds.credentialRefId} がない`);
    } else if (cred.principal.kind === 'organization') {
      if (cred.principal.tenantId !== ds.tenantId) problems.push(`data source ${ds.id}: 別テナントの組織の資格情報`);
    } else {
      const owner = readers[0];
      if (readers.length !== 1 || owner?.userId !== cred.principal.userId) {
        problems.push(`data source ${ds.id}: 個人の資格情報は読者 1 人（その本人）のデータソースにしか使わない`);
      }
    }
    for (const id of ds.selfAddressIds) {
      const a = dir.address(id);
      if (!a || a.tenantId !== ds.tenantId || a.channel !== ds.channel) problems.push(`data source ${ds.id}: 送信元のアドレス ${id} が不正`);
    }
  }
  for (const l of seed.lists) {
    if (!dir.dataSource(l.dataSourceId)) problems.push(`list ${l.id}: data source ${l.dataSourceId} がない`);
  }
  return problems;
}
