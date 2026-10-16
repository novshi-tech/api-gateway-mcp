import type { Directory } from './directory';

export interface Membership {
  tenantId: string;
  partyId: string;
  listIds: string[];
}

/**
 * Viewer = User → 各テナントの Party → リスト所属。
 * スタンドはユーザーと同一権限で働くので、ゲートウェイから伝搬された User からそのまま導出する。
 * User を持たないゴースト Party は Viewer になれない。
 */
export interface Viewer {
  userId: string;
  memberships: Membership[];
}

export function deriveViewer(dir: Directory, userId: string): Viewer {
  const memberships = dir.partiesOfUser(userId).map((party) => ({
    tenantId: party.tenantId,
    partyId: party.id,
    listIds: dir.listIdsOfParty(party.id).filter((id) => dir.list(id)?.tenantId === party.tenantId),
  }));
  return { userId, memberships };
}

export function membership(viewer: Viewer, tenantId: string): Membership | undefined {
  return viewer.memberships.find((m) => m.tenantId === tenantId);
}

export function isMemberOfList(viewer: Viewer, tenantId: string, listId: string): boolean {
  return membership(viewer, tenantId)?.listIds.includes(listId) ?? false;
}
