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
  bookmark: Bookmark;
  changes: LogEntry[]; // Only the changes introduced by this specific bookmark
  baseCommit: string; // The commit this segment starts from (parent bookmark or trunk)
}

export interface BranchStack {
  segments: BookmarkSegment[]; // Ordered from base to top (trunk → intermediate → top)
  baseCommit: string; // The common ancestor with trunk for the entire stack
}

export interface ChangeGraph {
  bookmarks: Bookmark[];
  stacks: BranchStack[];
  segmentChanges: Map<string, LogEntry[]>; // bookmark name -> just its segment changes
}
