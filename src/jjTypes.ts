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

export interface BranchStack {
  bookmarks: Bookmark[];
  baseCommit: string; // The common ancestor with trunk
  changes: LogEntry[];
}

export interface ChangeGraph {
  bookmarks: Bookmark[];
  stacks: BranchStack[];
  allChanges: Map<string, LogEntry[]>; // bookmark name -> changes
}
