import type { Directory } from './directory';

export interface Membership {
  tenantId: string;
  partyId: string;
  /** 読者になっているリストと、そのデータソース */
  listIds: string[];
  dataSourceIds: string[];
}

/**
 * Viewer = User → 各テナントの Party → リストの読者。
 * スタンドはユーザーと同一権限で働くので、ゲートウェイから伝搬された User からそのまま導出する。
 * User を持たないゴースト Party は Viewer になれない。
 */
export interface Viewer {
  userId: string;
  memberships: Membership[];
}

export function deriveViewer(dir: Directory, userId: string): Viewer {
  const memberships = dir.partiesOfUser(userId).map((party) => {
    const lists = dir
      .listIdsOfParty(party.id)
      .map((id) => dir.list(id))
      .filter((l) => l !== undefined && l.tenantId === party.tenantId);
    return {
      tenantId: party.tenantId,
      partyId: party.id,
      listIds: lists.map((l) => l!.id),
      dataSourceIds: lists.map((l) => l!.dataSourceId),
    };
  });
  return { userId, memberships };
}

export function membership(viewer: Viewer, tenantId: string): Membership | undefined {
  return viewer.memberships.find((m) => m.tenantId === tenantId);
}

export function canReadDataSource(viewer: Viewer, tenantId: string, dataSourceId: string): boolean {
  return membership(viewer, tenantId)?.dataSourceIds.includes(dataSourceId) ?? false;
}
