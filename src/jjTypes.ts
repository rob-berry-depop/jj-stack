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
