import type { Directory } from './directory';

/**
 * Viewer = User → このデプロイ（チーム）の Contact → リストの読者。
 * スタンドはユーザーと同一権限で働くので、ゲートウェイから伝搬された User からそのまま導出する。
 * User を持たないゴースト Contact は Viewer になれない。Contact のない User は何も見えない。
 */
export interface Viewer {
  userId: string;
  contactId: string | null;
  /** 読者になっているリストと、そのデータソース */
  listIds: string[];
  dataSourceIds: string[];
}

export function deriveViewer(dir: Directory, userId: string): Viewer {
  const contact = dir.contactOfUser(userId);
  const lists = contact
    ? dir
        .listIdsOfContact(contact.id)
        .map((id) => dir.list(id))
        .filter((l) => l !== undefined)
    : [];
  return { userId, contactId: contact?.id ?? null, listIds: lists.map((l) => l.id), dataSourceIds: lists.map((l) => l.dataSourceId) };
}

export function canReadDataSource(viewer: Viewer, dataSourceId: string): boolean {
  return viewer.dataSourceIds.includes(dataSourceId);
}
