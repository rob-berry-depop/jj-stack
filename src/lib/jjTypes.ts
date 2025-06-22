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
  authoredAt: Date;
  committedAt: Date;
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

// AIDEV-NOTE: Narrowed segment type for submission planning
export interface NarrowedBookmarkSegment {
  bookmark: Bookmark; // The single selected bookmark for this segment
  changes: LogEntry[]; // The changes in this segment (for PR title generation)
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
  excludedBookmarkCount: number; // AIDEV-NOTE: Count of bookmarks excluded due to merge commits
}

// AIDEV-NOTE: Configuration for JJ binary and other settings
export interface JjConfig {
  binaryPath: string;
}
