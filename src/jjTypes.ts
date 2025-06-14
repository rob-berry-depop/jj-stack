export interface LogEntry {
  commit_id: string;
  change_id: string;
  author_name: string;
  author_email: string;
  description_first_line: string;
  parents: string[];
  local_bookmarks: string[];
  remote_bookmarks: string[];
  is_current_working_copy: boolean;
}

export interface Bookmark {
  name: string;
  commit_id: string;
  change_id: string;
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
