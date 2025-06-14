import { execFile } from "child_process";
import { promisify } from "util";
import { Octokit } from "octokit";
import { buildChangeGraph } from "./jjUtils.js";
import { getGitHubAuth } from "./auth.js";

const execFileAsync = promisify(execFile);
const JJ_BINARY = "/Users/keane/code/jj-v0.30.0-aarch64-apple-darwin";

// Use Octokit's built-in types
export type PullRequest = Awaited<
  ReturnType<Octokit["rest"]["pulls"]["get"]>
>["data"];
type PullRequestListItem = Awaited<
  ReturnType<Octokit["rest"]["pulls"]["list"]>
>["data"][0];

export interface RemoteBookmark {
  name: string;
  remote: string;
  commitId: string;
}

export interface GitHubConfig {
  owner: string;
  repo: string;
  octokit: Octokit;
}

export interface SubmissionPlan {
  targetBookmark: string;
  bookmarksToSubmit: string[];
  bookmarksNeedingPush: string[];
  bookmarksNeedingPR: {
    bookmark: string;
    baseBranch: string;
    prContent: { title: string };
  }[];
  bookmarksNeedingPRBaseUpdate: {
    bookmark: string;
    currentBaseBranch: string;
    expectedBaseBranch: string;
    pr: PullRequestListItem;
  }[];
  repoInfo: { owner: string; repo: string };
  existingPRs: Map<string, PullRequestListItem | null>;
  remoteBookmarks: Map<string, RemoteBookmark | null>;
}

export interface SubmissionCallbacks {
  onBookmarkValidated?: (bookmark: string) => void;
  onAnalyzingStack?: (targetBookmark: string) => void;
  onStackFound?: (bookmarks: string[]) => void;
  onCheckingRemotes?: (bookmarks: string[]) => void;
  onCheckingPRs?: (bookmarks: string[]) => void;
  onPlanReady?: (plan: SubmissionPlan) => void;
  onPushStarted?: (bookmark: string, remote: string) => void;
  onPushCompleted?: (bookmark: string, remote: string) => void;
  onPRStarted?: (bookmark: string, title: string, base: string) => void;
  onPRCompleted?: (bookmark: string, pr: PullRequest) => void;
  onPRBaseUpdateStarted?: (
    bookmark: string,
    currentBase: string,
    newBase: string,
  ) => void;
  onPRBaseUpdateCompleted?: (bookmark: string, pr: PullRequest) => void;
  onError?: (error: Error, context: string) => void;
}

export interface SubmissionResult {
  success: boolean;
  pushedBookmarks: string[];
  createdPRs: Array<{ bookmark: string; pr: PullRequest }>;
  updatedPRs: Array<{ bookmark: string; pr: PullRequest }>;
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
export async function getStackBookmarksToSubmit(
  bookmarkName: string,
): Promise<string[]> {
  const changeGraph = await buildChangeGraph();

  // Find which stack contains the target bookmark
  for (const stack of changeGraph.stacks) {
    const targetIndex = stack.segments.findIndex(
      (segment) => segment.bookmark.name === bookmarkName,
    );

    if (targetIndex !== -1) {
      // Return all bookmarks from root up to and including the target
      return stack.segments
        .slice(0, targetIndex + 1)
        .map((segment) => segment.bookmark.name);
    }
  }

  // If not found in any stack, it's a standalone bookmark
  return [bookmarkName];
}

/**
 * Check if a bookmark has a corresponding remote bookmark
 */
export async function checkRemoteBookmark(
  bookmarkName: string,
): Promise<RemoteBookmark | null> {
  try {
    const result = await execFileAsync(JJ_BINARY, [
      "bookmark",
      "list",
      "--all-remotes",
      bookmarkName,
    ]);

    // Parse the output to find remote bookmarks
    const lines = result.stdout.trim().split("\n");
    for (const line of lines) {
      // Try multiple patterns to match remote bookmarks
      // Pattern 1: bookmark@remote: commit_id
      let remoteMatch = line.match(/(\w+)@(\w+):\s*([a-f0-9]+)/);

      // Pattern 2: bookmark@remote commit_id (space separated)
      if (!remoteMatch) {
        remoteMatch = line.match(/(\w+)@(\w+)\s+([a-f0-9]+)/);
      }

      // Pattern 3: More flexible - any bookmark@remote pattern
      if (!remoteMatch) {
        remoteMatch = line.match(/(\w+)@(\w+).*?([a-f0-9]{7,})/);
      }

      if (remoteMatch && remoteMatch[1] === bookmarkName) {
        return {
          name: remoteMatch[1],
          remote: remoteMatch[2],
          commitId: remoteMatch[3],
        };
      }
    }

    return null;
  } catch {
    return null;
  }
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
  try {
    const result = await octokit.rest.pulls.list({
      owner,
      repo,
      head: `${owner}:${headBranch}`,
      state: "open",
    });

    const pulls = result.data;
    return pulls.length > 0 ? pulls[0] : null;
  } catch {
    return null;
  }
}

/**
 * Get the default branch name for the repository by finding what trunk() resolves to
 */
export async function getDefaultBranch(): Promise<string> {
  try {
    // List all remote bookmarks and look for common default branch names
    const bookmarkResult = await execFileAsync(JJ_BINARY, [
      "bookmark",
      "list",
      "--all-remotes",
    ]);

    const lines = bookmarkResult.stdout
      .trim()
      .split("\n")
      .filter((line) => line.trim());

    // Look for common trunk bookmark names in the results
    for (const line of lines) {
      const bookmarkName = line.trim();

      // Look for bookmark@remote pattern
      const match = bookmarkName.match(/^([^@\s:]+)@(\w+)/);
      if (match) {
        const name = match[1];
        if (name === "main" || name === "master" || name === "trunk") {
          return name;
        }
      }
    }

    // If no common names found, try to use the first remote bookmark
    for (const line of lines) {
      const match = line.match(/^([^@\s:]+)@(\w+)/);
      if (match) {
        return match[1];
      }
    }

    // Final fallback
    return "main";
  } catch {
    return "main";
  }
}

/**
 * Get the base branch for a bookmark based on what it's stacked on
 */
export async function getBaseBranch(bookmarkName: string): Promise<string> {
  try {
    const changeGraph = await buildChangeGraph();

    // Find the bookmark in our change graph
    for (const stack of changeGraph.stacks) {
      for (let i = 0; i < stack.segments.length; i++) {
        const segment = stack.segments[i];
        if (segment.bookmark.name === bookmarkName) {
          // If this is the first segment in the stack, it's based on the default branch
          if (i === 0) {
            return await getDefaultBranch();
          }

          // Otherwise, it's based on the previous segment's bookmark
          const previousSegment = stack.segments[i - 1];
          return previousSegment.bookmark.name;
        }
      }
    }

    // If not found in stacks, it's a standalone bookmark - use default branch
    return await getDefaultBranch();
  } catch {
    return "main";
  }
}

/**
 * Generate PR title from the bookmark's commits
 */
export async function generatePRTitle(bookmarkName: string): Promise<string> {
  try {
    const changeGraph = await buildChangeGraph();
    const segmentChanges = changeGraph.segmentChanges.get(bookmarkName);

    if (!segmentChanges || segmentChanges.length === 0) {
      return `Add ${bookmarkName}`;
    }

    // Use the latest commit's description as the title
    return segmentChanges[0].descriptionFirstLine || `Add ${bookmarkName}`;
  } catch {
    return `Add ${bookmarkName}`;
  }
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
): Promise<PullRequest> {
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
): Promise<PullRequest> {
  const result = await octokit.rest.pulls.update({
    owner,
    repo,
    pull_number: prNumber,
    base: newBaseBranch,
  });

  return result.data;
}

/**
 * Create or update a stack information comment on a PR
 */
export async function createOrUpdateStackComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number,
  bookmarkName: string,
  stackPRs: Array<{ bookmark: string; prNumber: number; prUrl: string }>,
): Promise<void> {
  const stackFooter =
    "*Created with [jj-stack](https://github.com/your-org/jj-stack)*";

  // Generate the stack comment content
  const currentIndex = stackPRs.findIndex((pr) => pr.bookmark === bookmarkName);
  let commentBody = `### 📚 Stack Information\n\n`;

  if (stackPRs.length === 1) {
    commentBody += `This PR contains 1 bookmark:\n\n`;
  } else {
    commentBody += `This PR is part of a stack of ${stackPRs.length} bookmarks:\n\n`;
  }

  for (let i = 0; i < stackPRs.length; i++) {
    const stackPR = stackPRs[i];
    const isCurrent = i === currentIndex;
    const marker = isCurrent ? "**→ " : "   ";
    const suffix = isCurrent ? " (this PR)**" : "";
    const link = isCurrent
      ? stackPR.bookmark
      : `[${stackPR.bookmark}](${stackPR.prUrl})`;
    commentBody += `${marker}${i + 1}. ${link}${suffix}\n`;
  }

  commentBody += `\n---\n${stackFooter}`;

  // List existing comments to find our stack comment
  const comments = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: prNumber,
  });

  // Find existing jj-stack comment by looking for our footer
  const existingComment = comments.data.find((comment) =>
    comment.body?.includes(stackFooter),
  );

  if (existingComment) {
    // Update existing comment
    await octokit.rest.issues.updateComment({
      owner,
      repo,
      comment_id: existingComment.id,
      body: commentBody,
    });
  } else {
    // Create new comment
    await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: prNumber,
      body: commentBody,
    });
  }
}

/**
 * Check for existing PRs for all bookmarks
 */
export async function checkExistingPRs(
  octokit: Octokit,
  owner: string,
  repo: string,
  bookmarkNames: string[],
): Promise<Map<string, PullRequestListItem | null>> {
  const results = new Map<string, PullRequestListItem | null>();

  for (const bookmarkName of bookmarkNames) {
    const existingPR = await findExistingPR(octokit, owner, repo, bookmarkName);
    results.set(bookmarkName, existingPR);
  }

  return results;
}

/**
 * Check remote bookmarks for all bookmarks in the list
 */
export async function checkRemoteBookmarks(
  bookmarkNames: string[],
): Promise<Map<string, RemoteBookmark | null>> {
  const results = new Map<string, RemoteBookmark | null>();

  for (const bookmarkName of bookmarkNames) {
    const remoteBookmark = await checkRemoteBookmark(bookmarkName);
    results.set(bookmarkName, remoteBookmark);
  }

  return results;
}

/**
 * Validate existing PRs against expected base branches and identify mismatches
 */
export async function validatePRBases(
  bookmarkNames: string[],
  existingPRs: Map<string, PullRequestListItem | null>,
): Promise<
  {
    bookmark: string;
    currentBaseBranch: string;
    expectedBaseBranch: string;
    pr: PullRequestListItem;
  }[]
> {
  const mismatches: {
    bookmark: string;
    currentBaseBranch: string;
    expectedBaseBranch: string;
    pr: PullRequestListItem;
  }[] = [];

  for (const bookmark of bookmarkNames) {
    const existingPR = existingPRs.get(bookmark);

    if (existingPR) {
      const expectedBaseBranch = await getBaseBranch(bookmark);
      const currentBaseBranch = existingPR.base.ref;

      if (currentBaseBranch !== expectedBaseBranch) {
        mismatches.push({
          bookmark,
          currentBaseBranch,
          expectedBaseBranch,
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

    // 2. Get all bookmarks in the stack that need to be submitted
    callbacks?.onAnalyzingStack?.(bookmarkName);
    const bookmarksToSubmit = await getStackBookmarksToSubmit(bookmarkName);
    callbacks?.onStackFound?.(bookmarksToSubmit);

    // 3. Get GitHub repository info
    const repoInfo = await getGitHubRepoInfo();

    // 4. Get GitHub configuration for Octokit instance
    const githubConfig = await getGitHubConfig();

    // 5. Check status of all bookmarks
    callbacks?.onCheckingRemotes?.(bookmarksToSubmit);
    const remoteBookmarks = await checkRemoteBookmarks(bookmarksToSubmit);

    callbacks?.onCheckingPRs?.(bookmarksToSubmit);
    const existingPRs = await checkExistingPRs(
      githubConfig.octokit,
      githubConfig.owner,
      githubConfig.repo,
      bookmarksToSubmit,
    );

    // 6. Validate existing PRs against expected base branches
    const bookmarksNeedingPRBaseUpdate = await validatePRBases(
      bookmarksToSubmit,
      existingPRs,
    );

    // 7. Determine what actions are needed
    const bookmarksNeedingPush: string[] = [];
    const bookmarksNeedingPR: {
      bookmark: string;
      baseBranch: string;
      prContent: { title: string };
    }[] = [];

    for (const bookmark of bookmarksToSubmit) {
      const hasRemote = remoteBookmarks.get(bookmark);
      const hasExistingPR = existingPRs.get(bookmark);

      if (!hasRemote) {
        bookmarksNeedingPush.push(bookmark);
      }

      if (!hasExistingPR) {
        bookmarksNeedingPR.push({
          bookmark,
          baseBranch: await getBaseBranch(bookmark),
          prContent: { title: await generatePRTitle(bookmark) },
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
      remoteBookmarks,
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
    // First, push all bookmarks that need pushing
    for (const bookmark of plan.bookmarksNeedingPush) {
      try {
        callbacks?.onPushStarted?.(bookmark, "origin");
        await pushBookmark(bookmark, "origin");
        callbacks?.onPushCompleted?.(bookmark, "origin");
        result.pushedBookmarks.push(bookmark);
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        result.errors.push({ error: err, context: `pushing ${bookmark}` });
        callbacks?.onError?.(err, `pushing ${bookmark}`);
        result.success = false;
      }
    }

    // Second, update PR bases for existing PRs that need it (in order from bottom to top)
    for (const {
      bookmark,
      currentBaseBranch,
      expectedBaseBranch,
      pr,
    } of plan.bookmarksNeedingPRBaseUpdate) {
      try {
        callbacks?.onPRBaseUpdateStarted?.(
          bookmark,
          currentBaseBranch,
          expectedBaseBranch,
        );

        const updatedPR = await updatePRBase(
          githubConfig.octokit,
          githubConfig.owner,
          githubConfig.repo,
          pr.number,
          expectedBaseBranch,
        );

        callbacks?.onPRBaseUpdateCompleted?.(bookmark, updatedPR);
        result.updatedPRs.push({ bookmark, pr: updatedPR });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        result.errors.push({
          error: err,
          context: `updating PR base for ${bookmark}`,
        });
        callbacks?.onError?.(err, `updating PR base for ${bookmark}`);
        result.success = false;
      }
    }

    // Then create PRs for bookmarks that need them (in order from bottom to top)
    for (const { bookmark, baseBranch, prContent } of plan.bookmarksNeedingPR) {
      try {
        callbacks?.onPRStarted?.(bookmark, prContent.title, baseBranch);

        const pr = await createPR(
          githubConfig.octokit,
          githubConfig.owner,
          githubConfig.repo,
          bookmark,
          baseBranch,
          prContent.title,
        );

        callbacks?.onPRCompleted?.(bookmark, pr);
        result.createdPRs.push({ bookmark, pr });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        result.errors.push({
          error: err,
          context: `creating PR for ${bookmark}`,
        });
        callbacks?.onError?.(err, `creating PR for ${bookmark}`);
        result.success = false;
      }
    }

    // Create stack comments for all PRs in the stack (both new and existing)
    const allStackPRs: Array<{
      bookmark: string;
      prNumber: number;
      prUrl: string;
    }> = [];

    // Add newly created PRs
    for (const { bookmark, pr } of result.createdPRs) {
      allStackPRs.push({
        bookmark,
        prNumber: pr.number,
        prUrl: pr.html_url,
      });
    }

    // Add existing PRs
    for (const bookmark of plan.bookmarksToSubmit) {
      const existingPR = plan.existingPRs.get(bookmark);
      if (existingPR && !allStackPRs.some((pr) => pr.bookmark === bookmark)) {
        allStackPRs.push({
          bookmark,
          prNumber: existingPR.number,
          prUrl: existingPR.html_url,
        });
      }
    }

    // Add updated PRs
    for (const { bookmark, pr } of result.updatedPRs) {
      if (!allStackPRs.some((stackPR) => stackPR.bookmark === bookmark)) {
        allStackPRs.push({
          bookmark,
          prNumber: pr.number,
          prUrl: pr.html_url,
        });
      }
    }

    // Create/update stack comments for all PRs (even single PR "stacks")
    if (allStackPRs.length > 0) {
      // Sort stack PRs by the order they appear in bookmarksToSubmit
      allStackPRs.sort((a, b) => {
        const indexA = plan.bookmarksToSubmit.indexOf(a.bookmark);
        const indexB = plan.bookmarksToSubmit.indexOf(b.bookmark);
        return indexA - indexB;
      });

      // Create/update stack comments for each PR
      for (const stackPR of allStackPRs) {
        try {
          await createOrUpdateStackComment(
            githubConfig.octokit,
            githubConfig.owner,
            githubConfig.repo,
            stackPR.prNumber,
            stackPR.bookmark,
            allStackPRs,
          );
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          result.errors.push({
            error: err,
            context: `creating stack comment for ${stackPR.bookmark}`,
          });
          callbacks?.onError?.(
            err,
            `creating stack comment for ${stackPR.bookmark}`,
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
