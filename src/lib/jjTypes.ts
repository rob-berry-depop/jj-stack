export interface LogEntry {
  commitId: string;
  changeId: string;
  authorName: string;
  authorEmail: string;
  descriptionFirstLine: string;
  parents: string[];
  localBookmarks: string[];
  remoteBookmarks: string[];
  isCurrentWorkingCopy: boolean;
}

export interface Bookmark {
  name: string;
  commitId: string;
  changeId: string;
  hasRemote: boolean;
  isSynced: boolean;
}

export interface BookmarkSegment {
  bookmarks: Bookmark[];
  changes: LogEntry[]; // Only the changes introduced by this specific bookmark
}

export interface BranchStack {
  segments: BookmarkSegment[]; // Ordered from base to top (trunk → intermediate → top)
}

export interface ChangeGraph {
  bookmarks: Map<string, Bookmark>;
  bookmarkToChangeId: Map<string, string>;
  bookmarkedChangeAdjacencyList: Map<string, string>;
  bookmarkedChangeIdToSegment: Map<string, LogEntry[]>;
  stackLeafs: Set<string>;
  stackRoots: Set<string>;
  stacks: BranchStack[];
}
