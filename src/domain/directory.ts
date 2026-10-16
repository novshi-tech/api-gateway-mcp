import type { Address, AttributeDef, Channel, List, Party, Principal, Seed } from './entities';
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

  list(listId: string): List | undefined {
    return this.seed.lists.find((l) => l.id === listId);
  }

  listsOfTenant(tenantId: string): List[] {
    return this.seed.lists.filter((l) => l.tenantId === tenantId);
  }

  /** User の各テナントでの Party。ゴースト Party は User を持たないので出てこない */
  partiesOfUser(userId: string): Party[] {
    return this.seed.parties.filter((p) => p.userId === userId);
  }

  listIdsOfParty(partyId: string): string[] {
    return this.seed.listMembers.filter((m) => m.partyId === partyId).map((m) => m.listId);
  }

  membersOfList(listId: string): Party[] {
    const ids = new Set(this.seed.listMembers.filter((m) => m.listId === listId).map((m) => m.partyId));
    return this.seed.parties.filter((p) => ids.has(p.id));
  }

  attributeDefs(listId: string): AttributeDef[] {
    return this.seed.attributeDefs.filter((d) => d.listId === listId);
  }

  /** at 時点で有効な Address を引く。期間付きの紐づけに対応する */
  findAddress(tenantId: string, ref: AddressRef, at?: string): Address | undefined {
    return this.seed.addresses.find(
      (a) =>
        a.tenantId === tenantId &&
        a.channel === ref.channel &&
        a.value.toLowerCase() === ref.value.toLowerCase() &&
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

  /** 自分側（internal な Party）のアドレスか。InboundSignal が受信か観測された送信かを決める */
  isInternalAddress(tenantId: string, ref: AddressRef, at?: string): boolean {
    const partyId = this.partyIdOfAddress(tenantId, ref, at);
    return partyId !== null && this.party(partyId)?.internal === true;
  }

  /**
   * 取得主体ルール: シグナルは、取得に使った資格情報の主体が見えるリストにしか置けない。
   * Organization 主体 → チャネルごとの許可リスト、User 主体 → その User が所属するリスト。
   */
  allowedListIds(tenantId: string, principal: Principal, channel: Channel): string[] {
    if (principal.kind === 'organization') {
      if (principal.tenantId !== tenantId) return [];
      return this.seed.channelPolicies
        .filter((p) => p.tenantId === tenantId && p.channel === channel)
        .flatMap((p) => p.allowedListIds);
    }
    const party = this.seed.parties.find((p) => p.tenantId === tenantId && p.userId === principal.userId);
    if (!party) return [];
    return this.listIdsOfParty(party.id).filter((id) => this.list(id)?.tenantId === tenantId);
  }
}

function isValidAt(a: Address, at?: string): boolean {
  if (!at) return true;
  if (a.validFrom && at < a.validFrom) return false;
  if (a.validTo && at >= a.validTo) return false;
  return true;
}
