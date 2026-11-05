import type { SpaceMember } from '../../domain';
import type { JiraBrowser } from './api';

// Jira の共有リストの読者（0037 の決定 2）: プロジェクトを閲覧できるアカウントのうち、人（atlassian）で有効なもの。
// アプリのアカウントは読者にしない。対応（accountId → User）は本人の名乗り（myself）で付いたものだけを使う（ドメインの syncSharedReaders）

export function jiraMembers(browsers: readonly JiraBrowser[]): SpaceMember[] {
  return browsers.filter((b) => b.accountType === 'atlassian' && b.active).map((b) => ({ address: { channel: 'jira', value: b.accountId } }));
}

/** 読者の同期の間隔（見回りのたびには読まない） */
export const READERS_SYNC_MINUTES = 60;
