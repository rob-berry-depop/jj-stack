import { execFile } from "child_process";
import { promisify } from "util";
import { Octokit } from "octokit";
import { buildChangeGraph, gitFetch } from "./jjUtils.js";
import { getGitHubAuth } from "./auth.js";
import type { Bookmark, ChangeGraph } from "./jjTypes.js";
import * as v from "valibot";

const execFileAsync = promisify(execFile);
const JJ_BINARY = "/Users/keane/code/jj-v0.30.0-aarch64-apple-darwin";

export type PullRequest = PullRequestItem | PullRequestListItem;
type PullRequestItem = Awaited<
  ReturnType<Octokit["rest"]["pulls"]["get"]>
>["data"];
type PullRequestListItem = Awaited<
  ReturnType<Octokit["rest"]["pulls"]["list"]>
>["data"][0];

export interface GitHubConfig {
  owner: string;
  repo: string;
  octokit: Octokit;
}

const PRCommentDataSchema = v.object({
  version: v.number(),
  stack: v.array(
    v.object({
      bookmarkName: v.string(),
      prUrl: v.pipe(v.string(), v.url()),
      prNumber: v.number(),
    }),
  ),
});
type PRCommentData = v.InferOutput<typeof PRCommentDataSchema>;

export interface SubmissionPlan {
  targetBookmark: string;
  bookmarksToSubmit: Bookmark[];
  bookmarksNeedingPush: Bookmark[];
  bookmarksNeedingPR: {
    bookmark: Bookmark;
    baseBranchOptions: string[];
    prContent: { title: string };
  }[];
  bookmarksNeedingPRBaseUpdate: {
    bookmark: Bookmark;
    currentBaseBranch: string;
    expectedBaseBranchOptions: string[];
    pr: PullRequest;
  }[];
  repoInfo: { owner: string; repo: string };
  existingPRs: Map<string, PullRequest>;
}

export interface SubmissionCallbacks {
  onBookmarkValidated?: (bookmark: string) => void;
  onAnalyzingStack?: (targetBookmark: string) => void;
  onStackFound?: (bookmarks: Bookmark[]) => void;
  onCheckingPRs?: (bookmarks: Bookmark[]) => void;
  onPlanReady?: (plan: SubmissionPlan) => void;
  onPushStarted?: (bookmark: Bookmark, remote: string) => void;
  onPushCompleted?: (bookmark: Bookmark, remote: string) => void;
  onPRStarted?: (bookmark: Bookmark, title: string, base: string) => void;
  onPRCompleted?: (bookmark: Bookmark, pr: PullRequest) => void;
  onPRBaseUpdateStarted?: (
    bookmark: Bookmark,
    currentBase: string,
    newBase: string,
  ) => void;
  onPRBaseUpdateCompleted?: (bookmark: Bookmark, pr: PullRequest) => void;
  onError?: (error: Error, context: string) => void;
}

export interface SubmissionResult {
  success: boolean;
  pushedBookmarks: Bookmark[];
  createdPRs: Array<{ bookmark: Bookmark; pr: PullRequest }>;
  updatedPRs: Array<{ bookmark: Bookmark; pr: PullRequest }>;
  errors: Array<{ error: Error; context: string }>;
}

/**
 * Validate that a bookmark exists locally
 */
export async function validateBookmark(bookmarkName: string): Promise<void> {
  const result = await execFileAsync(JJ_BINARY, [
    "bookmark",
    "list",
    bookmarkName,
  ]);

  if (!result.stdout.trim()) {
    throw new Error(`Bookmark '${bookmarkName}' does not exist locally`);
  }
}

/**
 * Get all bookmarks in the stack that need to be submitted (including the target bookmark)
 */
export function getStackBookmarksToSubmit(
  bookmarkName: string,
  changeGraph: ChangeGraph,
): Bookmark[] {
  // Find which stack contains the target bookmark
  for (const stack of changeGraph.stacks) {
    const targetIndex = stack.segments.findIndex((segment) =>
      segment.bookmarks.map((b) => b.name).includes(bookmarkName),
    );

    if (targetIndex !== -1) {
      // Return all bookmarks from root up to and including the target
      return stack.segments
        .slice(0, targetIndex + 1)
        .flatMap((segment) => segment.bookmarks); // TODO: allow user to pick which bookmark to submit
    }
  }

  throw new Error(`Bookmark '${bookmarkName}' not found in any stack`);
}

/**
 * Extract GitHub owner and repo from jj git remote URL
 */
export async function getGitHubRepoInfo(): Promise<{
  owner: string;
  repo: string;
}> {
  // Get the origin remote URL using JJ
  const result = await execFileAsync(JJ_BINARY, ["git", "remote", "list"]);
  const lines = result.stdout.trim().split("\n");

  // Find the origin remote
  let originUrl = "";
  for (const line of lines) {
    // JJ git remote list format: "remote_name url"
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 2 && parts[0] === "origin") {
      originUrl = parts[1];
      break;
    }
  }

  if (!originUrl) {
    throw new Error("No 'origin' remote found");
  }

  // Parse GitHub URLs - support both HTTPS and SSH formats
  // HTTPS: https://github.com/owner/repo.git
  // SSH: git@github.com:owner/repo.git
  const match = originUrl.match(/github\.com[:/]([^/]+)\/([^/.]+)/);

  if (!match) {
    throw new Error(
      `Could not parse GitHub repository from remote URL: ${originUrl}`,
    );
  }

  const owner = match[1];
  let repo = match[2];

  // Remove .git suffix if present
  if (repo.endsWith(".git")) {
    repo = repo.slice(0, -4);
  }

  return { owner, repo };
}

/**
 * Get the GitHub configuration from environment or config
 */
export async function getGitHubConfig(): Promise<GitHubConfig> {
  // Get authentication using the auth utility
  const authConfig = await getGitHubAuth();
  const octokit = new Octokit({ auth: authConfig.token });

  // Try to extract owner/repo from git remote, fall back to environment variables
  let owner = process.env.GITHUB_OWNER;
  let repo = process.env.GITHUB_REPO;

  if (!owner || !repo) {
    const repoInfo = await getGitHubRepoInfo();
    owner = repoInfo.owner;
    repo = repoInfo.repo;
  }

  return { owner, repo, octokit };
}

/**
 * Check if a PR already exists for the given branch
 */
export async function findExistingPR(
  octokit: Octokit,
  owner: string,
  repo: string,
  headBranch: string,
): Promise<PullRequestListItem | null> {
  const result = await octokit.rest.pulls.list({
    owner,
    repo,
    head: `${owner}:${headBranch}`,
    state: "open",
  });

  const pulls = result.data;
  return pulls.length > 0 ? pulls[0] : null;
}

const RemoteBookmarksSchema = v.array(v.string());
/**
 * Get the default branch name for the repository by finding what trunk() resolves to
 */
export async function getDefaultBranch(): Promise<string> {
  const template = `'[ ' ++ remote_bookmarks.map(|b| b.name().escape_json()).join(",") ++ ']\n'`;
  const result = await execFileAsync(JJ_BINARY, [
    "log",
    "--revisions",
    "trunk()",
    "--no-graph",
    "--limit",
    "1",
    "--template",
    template,
  ]);

  let remoteBookmarks: string[];
  try {
    remoteBookmarks = v.parse(RemoteBookmarksSchema, JSON.parse(result.stdout));
  } catch (e) {
    throw new Error(
      `Failed to parse remote bookmarks from jj log output: ${String(e)}`,
    );
  }

  const candidates = ["main", "master", "trunk"];
  for (const candidate of candidates) {
    if (remoteBookmarks.includes(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    `Could not find a remote bookmark for default branch (main, master, or trunk) in: ${JSON.stringify(remoteBookmarks)}`,
  );
}

/**
 * Get the base branch for a bookmark based on what it's stacked on
 */
export function getBaseBranchOptions(
  bookmarkName: string,
  changeGraph: ChangeGraph,
  defaultBranch: string,
): string[] {
  // Find the bookmark in our change graph
  for (const stack of changeGraph.stacks) {
    for (let i = 0; i < stack.segments.length; i++) {
      const segment = stack.segments[i];
      if (segment.bookmarks.map((b) => b.name).includes(bookmarkName)) {
        // If this is the first segment in the stack, it's based on the default branch
        if (i === 0) {
          return [defaultBranch];
        }

        // Otherwise, it's based on the previous segment's bookmark
        const previousSegment = stack.segments[i - 1];
        return previousSegment.bookmarks.map((b) => b.name);
      }
    }
  }

  throw new Error(
    `Bookmark '${bookmarkName}' not found in any stack to determine base branch`,
  );
}

/**
 * Generate PR title from the bookmark's commits
 */
export function generatePRTitle(
  bookmarkName: string,
  changeGraph: ChangeGraph,
): string {
  const changeId = changeGraph.bookmarkToChangeId.get(bookmarkName);
  if (!changeId) {
    throw new Error(`Change not found for bookmark ${bookmarkName}`);
  }
  const segmentChanges = changeGraph.bookmarkedChangeIdToSegment.get(changeId);
  if (!segmentChanges || segmentChanges.length === 0) {
    throw new Error(`Segment not found or invalid for change id ${changeId}`);
  }

  // Use the latest commit's description as the title
  return segmentChanges[0].descriptionFirstLine || bookmarkName;
}

/**
 * Push the bookmark to the remote
 */
export async function pushBookmark(
  bookmarkName: string,
  remote: string = "origin",
): Promise<void> {
  await execFileAsync(JJ_BINARY, [
    "git",
    "push",
    "--remote",
    remote,
    "--bookmark",
    bookmarkName,
    "--allow-new",
  ]);
}

/**
 * Create a new PR
 */
export async function createPR(
  octokit: Octokit,
  owner: string,
  repo: string,
  bookmarkName: string,
  baseBranch: string,
  title: string,
): Promise<PullRequestItem> {
  const result = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    head: bookmarkName,
    base: baseBranch,
  });

  return result.data;
}

/**
 * Update the base branch of an existing PR
 */
export async function updatePRBase(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  newBaseBranch: string,
): Promise<PullRequestItem> {
  const result = await octokit.rest.pulls.update({
    owner,
    repo,
    pull_number: prNumber,
    base: newBaseBranch,
  });

  return result.data;
}

const commentDataPrefix = "<!--- JJ-STACK_INFO: ";
const commentDataPostfix = " --->";
const stackCommentFooter =
  "*Created with [jj-stack](https://github.com/keanemind/jj-stack)*";
const stackCommentThisPRText = "← this PR";

/**
 * Create or update a stack information comment on a PR
 */
export async function createOrUpdateStackComment(
  githubConfig: GitHubConfig,
  prCommentData: PRCommentData,
  currentBookmarkIdx: number,
): Promise<void> {
  const encodedPRCommentData = Buffer.from(
    JSON.stringify(prCommentData),
  ).toString("base64");
  let commentBody = `${commentDataPrefix}${encodedPRCommentData}${commentDataPostfix}\nThis PR is part of a stack of ${prCommentData.stack.length} bookmark${prCommentData.stack.length === 1 ? "" : "s"}:\n\n`;

  for (let i = 0; i < prCommentData.stack.length; i++) {
    const stackItem = prCommentData.stack[i];
    const isCurrent = i === currentBookmarkIdx;
    if (isCurrent) {
      commentBody += `1. **${stackItem.bookmarkName} ${stackCommentThisPRText}**\n`;
    } else {
      commentBody += `1. [${stackItem.bookmarkName}](${stackItem.prUrl})\n`;
    }
  }

  commentBody += `\n---\n${stackCommentFooter}`;

  const currentPRnumber = prCommentData.stack[currentBookmarkIdx].prNumber;

  // List existing comments to find our stack comment
  const comments = await githubConfig.octokit.rest.issues.listComments({
    owner: githubConfig.owner,
    repo: githubConfig.repo,
    issue_number: currentPRnumber,
  });

  // Find existing jj-stack comment by looking for our footer
  const existingComment = comments.data.find((comment) =>
    comment.body?.includes(stackCommentFooter),
  );

  if (existingComment) {
    // Update existing comment
    await githubConfig.octokit.rest.issues.updateComment({
      owner: githubConfig.owner,
      repo: githubConfig.repo,
      comment_id: existingComment.id,
      body: commentBody,
    });
  } else {
    // Create new comment
    await githubConfig.octokit.rest.issues.createComment({
      owner: githubConfig.owner,
      repo: githubConfig.repo,
      issue_number: currentPRnumber,
      body: commentBody,
    });
  }
}

async function findCommentData(
  githubConfig: GitHubConfig,
  prNumber: number,
): Promise<PRCommentData | undefined> {
  const comments = await githubConfig.octokit.rest.issues.listComments({
    owner: githubConfig.owner,
    repo: githubConfig.repo,
    issue_number: prNumber,
  });

  const comment = comments.data.find((comment) =>
    comment.body?.includes(stackCommentFooter),
  );

  if (comment?.body) {
    const lines = comment.body.trim().split("\n");
    if (
      lines[0] &&
      lines[0].includes(commentDataPrefix) &&
      lines[0].includes(commentDataPostfix)
    ) {
      const rawData = lines[0].slice(
        commentDataPrefix.length,
        -commentDataPostfix.length,
      );
      const decoded = Buffer.from(rawData, "base64").toString();
      try {
        const parsedJson = JSON.parse(decoded) as unknown;
        return v.parse(PRCommentDataSchema, parsedJson);
      } catch {
        // ignore
      }
    }
  }
  return undefined;
}

/**
 * Check for existing PRs for all bookmarks
 */
export async function getExistingPRs(
  octokit: Octokit,
  owner: string,
  repo: string,
  bookmarks: Bookmark[],
): Promise<Map<string, PullRequestListItem>> {
  const results = new Map<string, PullRequestListItem>();

  for (const bookmark of bookmarks) {
    const existingPR = await findExistingPR(
      octokit,
      owner,
      repo,
      bookmark.name,
    );
    if (existingPR) {
      results.set(bookmark.name, existingPR);
    }
  }

  return results;
}

/**
 * Validate existing PRs against expected base branches and identify mismatches
 */
export function validatePRBases(
  bookmarks: Bookmark[],
  existingPRs: Map<string, PullRequestListItem | null>,
  changeGraph: ChangeGraph,
  defaultBranch: string,
): {
  bookmark: Bookmark;
  currentBaseBranch: string;
  expectedBaseBranchOptions: string[];
  pr: PullRequestListItem;
}[] {
  const mismatches: {
    bookmark: Bookmark;
    currentBaseBranch: string;
    expectedBaseBranchOptions: string[];
    pr: PullRequestListItem;
  }[] = [];

  for (const bookmark of bookmarks) {
    const existingPR = existingPRs.get(bookmark.name);

    if (existingPR) {
      const expectedBaseBranchOptions = getBaseBranchOptions(
        bookmark.name,
        changeGraph,
        defaultBranch,
      );
      const currentBaseBranch = existingPR.base.ref;

      if (!expectedBaseBranchOptions.includes(currentBaseBranch)) {
        mismatches.push({
          bookmark,
          currentBaseBranch,
          expectedBaseBranchOptions,
          pr: existingPR,
        });
      }
    }
  }

  return mismatches;
}

/**
 * Analyze what needs to be done for submission and create a plan
 */
export async function analyzeSubmissionPlan(
  bookmarkName: string,
  callbacks?: SubmissionCallbacks,
): Promise<SubmissionPlan> {
  try {
    // 1. Validate target bookmark exists locally
    await validateBookmark(bookmarkName);
    callbacks?.onBookmarkValidated?.(bookmarkName);

    await gitFetch();

    // 2. Build change graph once for all operations
    const changeGraph = await buildChangeGraph();

    // 3. Get all bookmarks in the stack that need to be submitted
    callbacks?.onAnalyzingStack?.(bookmarkName);
    const bookmarksToSubmit = getStackBookmarksToSubmit(
      bookmarkName,
      changeGraph,
    );
    callbacks?.onStackFound?.(bookmarksToSubmit);

    // 3. Get GitHub repository info
    const repoInfo = await getGitHubRepoInfo();

    // 4. Get GitHub configuration for Octokit instance
    const githubConfig = await getGitHubConfig();

    callbacks?.onCheckingPRs?.(bookmarksToSubmit);
    const existingPRs = await getExistingPRs(
      githubConfig.octokit,
      githubConfig.owner,
      githubConfig.repo,
      bookmarksToSubmit,
    );

    const defaultBranch = await getDefaultBranch();

    // 6. Validate existing PRs against expected base branches
    const bookmarksNeedingPRBaseUpdate = validatePRBases(
      bookmarksToSubmit,
      existingPRs,
      changeGraph,
      defaultBranch,
    );

    // 7. Determine what actions are needed
    const bookmarksNeedingPush: Bookmark[] = [];
    const bookmarksNeedingPR: SubmissionPlan["bookmarksNeedingPR"] = [];

    for (const bookmark of bookmarksToSubmit) {
      const hasExistingPR = existingPRs.get(bookmark.name);

      if (!bookmark.hasRemote || !bookmark.isSynced) {
        bookmarksNeedingPush.push(bookmark);
      }

      if (!hasExistingPR) {
        bookmarksNeedingPR.push({
          bookmark,
          baseBranchOptions: getBaseBranchOptions(
            bookmark.name,
            changeGraph,
            defaultBranch,
          ),
          prContent: { title: generatePRTitle(bookmark.name, changeGraph) },
        });
      }
    }

    const plan: SubmissionPlan = {
      targetBookmark: bookmarkName,
      bookmarksToSubmit,
      bookmarksNeedingPush,
      bookmarksNeedingPR,
      bookmarksNeedingPRBaseUpdate,
      repoInfo,
      existingPRs,
    };

    callbacks?.onPlanReady?.(plan);
    return plan;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    callbacks?.onError?.(err, "planning");
    throw err;
  }
}

/**
 * Execute the submission plan
 */
export async function executeSubmissionPlan(
  plan: SubmissionPlan,
  githubConfig: GitHubConfig,
  callbacks?: SubmissionCallbacks,
): Promise<SubmissionResult> {
  const result: SubmissionResult = {
    success: true,
    pushedBookmarks: [],
    createdPRs: [],
    updatedPRs: [],
    errors: [],
  };

  try {
    // Push all bookmarks that need pushing
    for (const bookmark of plan.bookmarksNeedingPush) {
      try {
        callbacks?.onPushStarted?.(bookmark, "origin");
        await pushBookmark(bookmark.name, "origin");
        callbacks?.onPushCompleted?.(bookmark, "origin");
        result.pushedBookmarks.push(bookmark);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        result.errors.push({ error: err, context: `pushing ${bookmark.name}` });
        callbacks?.onError?.(err, `pushing ${bookmark.name}`);
        result.success = false;
      }
    }

    const bookmarkToPR = new Map<string, PullRequest>(plan.existingPRs);

    // Update PR bases for existing PRs that need it (in order from bottom to top)
    for (const {
      bookmark,
      currentBaseBranch,
      expectedBaseBranchOptions,
      pr,
    } of plan.bookmarksNeedingPRBaseUpdate) {
      try {
        if (expectedBaseBranchOptions.length !== 1) {
          throw new Error(
            `Expected exactly one base branch option for ${bookmark.name}, but got ${expectedBaseBranchOptions.length}`,
          );
        }

        callbacks?.onPRBaseUpdateStarted?.(
          bookmark,
          currentBaseBranch,
          expectedBaseBranchOptions[0],
        );

        const updatedPR = await updatePRBase(
          githubConfig.octokit,
          githubConfig.owner,
          githubConfig.repo,
          pr.number,
          expectedBaseBranchOptions[0],
        );

        callbacks?.onPRBaseUpdateCompleted?.(bookmark, updatedPR);
        result.updatedPRs.push({ bookmark, pr: updatedPR });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        result.errors.push({
          error: err,
          context: `updating PR base for ${bookmark.name}`,
        });
        callbacks?.onError?.(err, `updating PR base for ${bookmark.name}`);
        result.success = false;
      }
    }

    // Then create PRs for bookmarks that need them (in order from bottom to top)
    for (const {
      bookmark,
      baseBranchOptions,
      prContent,
    } of plan.bookmarksNeedingPR) {
      try {
        if (baseBranchOptions.length !== 1) {
          throw new Error(
            `Expected exactly one base branch option for ${bookmark.name}, but got ${baseBranchOptions.length}`,
          );
        }

        callbacks?.onPRStarted?.(
          bookmark,
          prContent.title,
          baseBranchOptions[0],
        );

        const pr = await createPR(
          githubConfig.octokit,
          githubConfig.owner,
          githubConfig.repo,
          bookmark.name,
          baseBranchOptions[0],
          prContent.title,
        );

        callbacks?.onPRCompleted?.(bookmark, pr);
        result.createdPRs.push({ bookmark, pr });
        bookmarkToPR.set(bookmark.name, pr);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        result.errors.push({
          error: err,
          context: `creating PR for ${bookmark.name}`,
        });
        callbacks?.onError?.(err, `creating PR for ${bookmark.name}`);
        result.success = false;
      }
    }

    // Create/update stack comments for all PRs
    if (bookmarkToPR.size > 0) {
      const rootBookmark = plan.bookmarksToSubmit[0];
      const rootPR = bookmarkToPR.get(rootBookmark.name);
      if (!rootPR) {
        throw new Error(
          "PR not found in bookmarkToPr for bookmark in bookmarksToSubmit",
        );
      }

      const alreadyMergedStack = await (async () => {
        const rootPRCommentData = await findCommentData(
          githubConfig,
          rootPR.number,
        );
        if (rootPRCommentData === undefined) {
          return [];
        }

        const rootPRIdx = rootPRCommentData.stack.findIndex(
          (item) => item.prNumber === rootPR.number,
        );
        if (rootPRIdx === -1) {
          // This shouldn't be possible. The root PR's comment's data is invalid.
          return [];
        }

        const rootParentPRInfo = rootPRCommentData.stack[rootPRIdx - 1];

        const rootParentPR = (
          await githubConfig.octokit.rest.pulls.get({
            owner: githubConfig.owner,
            repo: githubConfig.repo,
            pull_number: rootParentPRInfo.prNumber,
          })
        ).data;

        if (!rootParentPR.merged) {
          return [];
        }

        return rootPRCommentData.stack.slice(0, rootPRIdx);
      })();

      const prCommentData = {
        version: 0,
        stack: [
          ...alreadyMergedStack,
          ...plan.bookmarksToSubmit.map((bookmark) => {
            const pr = bookmarkToPR.get(bookmark.name);
            if (!pr) {
              throw new Error(
                "PR not found in bookmarkToPr for bookmark in bookmarksToSubmit",
              );
            }
            return {
              bookmarkName: bookmark.name,
              prUrl: pr.html_url,
              prNumber: pr.number,
            };
          }),
        ],
      } satisfies PRCommentData;

      for (let i = 0; i < plan.bookmarksToSubmit.length; i++) {
        const bookmark = plan.bookmarksToSubmit[i];
        const stackPR = bookmarkToPR.get(bookmark.name);
        if (!stackPR) {
          throw new Error(
            "PR not found in bookmarkToPR for bookmark in bookmarksToSubmit",
          );
        }

        try {
          await createOrUpdateStackComment(githubConfig, prCommentData, i);
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          result.errors.push({
            error: err,
            context: `creating stack comment for ${bookmark.name}`,
          });
          callbacks?.onError?.(
            err,
            `creating stack comment for ${bookmark.name}`,
          );
          // Don't mark as failed for comment errors
        }
      }
    }

    return result;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    result.errors.push({ error: err, context: "execution" });
    callbacks?.onError?.(err, "execution");
    result.success = false;
    return result;
  }
}
