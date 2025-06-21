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
  authoredAt: Date.t,
  committedAt: Date.t,
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

// AIDEV-NOTE: Narrowed segment type for submission planning
type narrowedBookmarkSegment = {
  bookmark: bookmark,
  changes: array<logEntry>,
}

type branchStack = {segments: array<bookmarkSegment>}

type changeGraph = {
  bookmarks: Map.t<string, bookmark>,
  bookmarkToChangeId: Map.t<string, string>,
  bookmarkedChangeAdjacencyList: Map.t<string, string>,
  bookmarkedChangeIdToSegment: Map.t<string, array<logEntry>>,
  stackLeafs: Set.t<string>,
  stackRoots: Set.t<string>,
  stacks: array<branchStack>,
}

// AIDEV-NOTE: Types for three-phase submission approach (mirrors TypeScript types)

type submissionAnalysis = {
  targetBookmark: string,
  changeGraph: changeGraph,
  relevantSegments: array<bookmarkSegment>,
}

// AIDEV-NOTE: Configuration for JJ binary and other settings
type jjConfig = {binaryPath: string}

type gitRemote = {
  name: string,
  url: string,
}

// AIDEV-NOTE: JJ function interface for dependency injection
type jjFunctions = {
  gitFetch: unit => promise<unit>,
  getMyBookmarks: unit => promise<array<bookmark>>,
  getBranchChangesPaginated: (string, string, option<string>) => promise<array<logEntry>>,
  getGitRemoteList: unit => array<gitRemote>,
  getDefaultBranch: unit => string,
  pushBookmark: (string, string) => unit,
}
