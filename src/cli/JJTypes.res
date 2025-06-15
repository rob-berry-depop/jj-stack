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
  bookmarks: array<bookmark>,
  changes: array<logEntry>,
}

type branchStack = {segments: array<bookmarkSegment>}

type changeGraph = {
  bookmarks: array<bookmark>,
  stackingRelationships: Map.t<string, array<string>>,
  segmentChanges: Map.t<string, array<logEntry>>,
  stacks: array<branchStack>,
}
