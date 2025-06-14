import { execFile } from "child_process";
import { promisify } from "util";
import { Octokit } from "octokit";
import { buildChangeGraph } from "./jjUtils.js";
import { getGitHubAuth } from "./authUtils.js";

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
    prContent: { title: string; body: string };
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
  onError?: (error: Error, context: string) => void;
}

export interface SubmissionResult {
  success: boolean;
  pushedBookmarks: string[];
  createdPRs: Array<{ bookmark: string; pr: PullRequest }>;
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
 * Generate PR title and body from the bookmark's commits
 */
export async function generatePRContent(
  bookmarkName: string,
): Promise<{ title: string; body: string }> {
  try {
    const changeGraph = await buildChangeGraph();
    const segmentChanges = changeGraph.segmentChanges.get(bookmarkName);

    if (!segmentChanges || segmentChanges.length === 0) {
      return {
        title: `Add ${bookmarkName}`,
        body: `Changes from bookmark ${bookmarkName}`,
      };
    }

    // Use the latest commit's description as the title
    const title =
      segmentChanges[0].descriptionFirstLine || `Add ${bookmarkName}`;

    // Generate more detailed body
    let body = `## Changes in \`${bookmarkName}\`\n\n`;

    if (segmentChanges.length === 1) {
      body += `This PR contains a single commit:\n\n`;
    } else {
      body += `This PR contains ${segmentChanges.length} commits:\n\n`;
    }

    for (let i = 0; i < segmentChanges.length; i++) {
      const change = segmentChanges[i];
      body += `${i + 1}. **${change.descriptionFirstLine}**\n`;
      body += `   \`${change.commitId}\` by ${change.authorName}\n\n`;
    }

    // Add stacking information if this is part of a stack
    for (const stack of changeGraph.stacks) {
      const segmentIndex = stack.segments.findIndex(
        (s) => s.bookmark.name === bookmarkName,
      );
      if (segmentIndex !== -1) {
        if (stack.segments.length > 1) {
          body += `---\n\n`;
          body += `### 📚 Stack Information\n\n`;
          body += `This PR is part of a stack of ${stack.segments.length} bookmarks:\n\n`;

          for (let i = 0; i < stack.segments.length; i++) {
            const segment = stack.segments[i];
            const isCurrent = i === segmentIndex;
            const marker = isCurrent ? "**→ " : "   ";
            const suffix = isCurrent ? " (this PR)**" : "";
            body += `${marker}${i + 1}. ${segment.bookmark.name}${suffix}\n`;
          }
          body += `\n`;
        }
        break;
      }
    }

    body += `---\n*Created with [jj-stack](https://github.com/your-org/jj-stack)*`;

    return { title, body };
  } catch {
    return {
      title: `Add ${bookmarkName}`,
      body: `Changes from bookmark ${bookmarkName}`,
    };
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
  body: string,
): Promise<PullRequest> {
  const result = await octokit.rest.pulls.create({
    owner,
    repo,
    title,
    body,
    head: bookmarkName,
    base: baseBranch,
  });

  return result.data;
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

    // 6. Determine what actions are needed
    const bookmarksNeedingPush: string[] = [];
    const bookmarksNeedingPR: {
      bookmark: string;
      baseBranch: string;
      prContent: { title: string; body: string };
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
          prContent: await generatePRContent(bookmark),
        });
      }
    }

    const plan: SubmissionPlan = {
      targetBookmark: bookmarkName,
      bookmarksToSubmit,
      bookmarksNeedingPush,
      bookmarksNeedingPR,
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
          prContent.body,
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

    return result;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    result.errors.push({ error: err, context: "execution" });
    callbacks?.onError?.(err, "execution");
    result.success = false;
    return result;
  }
}
