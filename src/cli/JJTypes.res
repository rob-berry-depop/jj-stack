type logEntry = {
  commitId: string,
  changeId: string,
  authorName: string,
  authorEmail: string,
  descriptionFirstLine: string,
  parents: array<string>,
  localBookmarks: array<string>,
  remoteBookmarks: array<string>,
  isCurrentWorkingCopy: bool,
}

type bookmark = {
  name: string,
  commitId: string,
  changeId: string,
  hasRemote: bool,
  isSynced: bool,
}

type bookmarkSegment = {
  bookmark: bookmark,
  changes: array<logEntry>,
  baseCommit: string,
}

type branchStack = {
  segments: array<bookmarkSegment>,
  baseCommit: string,
}

type changeGraph = {
  bookmarks: array<bookmark>,
  stacks: array<branchStack>,
  segmentChanges: Map.t<string, array<logEntry>>,
}
