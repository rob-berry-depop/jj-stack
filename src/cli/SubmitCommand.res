type prContent = {
  title: string,
  body: string,
}

type bookmarkNeedingPR = {
  bookmark: string,
  baseBranch: string,
  prContent: prContent,
}

type repoInfo = {
  owner: string,
  repo: string,
}

type pullRequestBaseOrHead = {
  label: string,
  ref: string,
  sha: string,
}

type pullRequest = {
  id: string,
  html_url: string,
  title: string,
  base: pullRequestBaseOrHead,
  head: pullRequestBaseOrHead,
}

type remoteBookmark = {
  name: string,
  remote: string,
  commitId: string,
}

type submissionPlan = {
  targetBookmark: string,
  bookmarksToSubmit: array<string>,
  bookmarksNeedingPush: array<string>,
  bookmarksNeedingPR: array<bookmarkNeedingPR>,
  repoInfo: repoInfo,
  existingPRs: Map.t<string, pullRequest>,
  remoteBookmarks: Map.t<string, remoteBookmark>,
}

type submissionCallbacks = {
  onBookmarkValidated: option<string => unit>,
  onAnalyzingStack: option<string => unit>,
  onStackFound: option<array<string> => unit>,
  onCheckingRemotes: option<array<string> => unit>,
  onCheckingPRs: option<array<string> => unit>,
  onPlanReady: option<submissionPlan => unit>,
  onPushStarted: option<(string, string) => unit>,
  onPushCompleted: option<(string, string) => unit>,
  onPRStarted: option<(string, string, string) => unit>,
  onPRCompleted: option<(string, pullRequest) => unit>,
  onError: option<(Exn.t, string) => unit>,
}

type createdPr = {
  bookmark: string,
  pr: pullRequest,
}

type errorWithContext = {
  error: Exn.t,
  context: string,
}

type submissionResult = {
  success: bool,
  pushedBookmarks: array<string>,
  createdPrs: array<createdPr>,
  errors: array<errorWithContext>,
}

@module("../lib/submitUtils.js")
external analyzeSubmissionPlan: (string, option<submissionCallbacks>) => promise<submissionPlan> =
  "analyzeSubmissionPlan"
