import { execFile } from "child_process";
import { promisify } from "util";
import { Octokit } from "octokit";
import { buildChangeGraph } from "../lib/jjUtils.js";
import { getGitHubAuth } from "../lib/authUtils.js";

const execFileAsync = promisify(execFile);
const JJ_BINARY = "/Users/keane/code/jj-v0.30.0-aarch64-apple-darwin";

// Use Octokit's built-in types
type PullRequest = Awaited<ReturnType<Octokit["rest"]["pulls"]["get"]>>["data"];
type PullRequestListItem = Awaited<
  ReturnType<Octokit["rest"]["pulls"]["list"]>
>["data"][0];

interface RemoteBookmark {
  name: string;
  remote: string;
  commit_id: string;
}

interface GitHubConfig {
  owner: string;
  repo: string;
  octokit: Octokit;
}

interface SubmitOptions {
  dryRun?: boolean;
}

/**
 * Check if a bookmark has a corresponding remote bookmark
 */
async function checkRemoteBookmark(
  bookmarkName: string,
): Promise<RemoteBookmark | null> {
  try {
    const result = await execFileAsync(JJ_BINARY, [
      "bookmark",
      "list",
      "--all-remotes",
      bookmarkName,
    ]);

    console.log(`JJ bookmark output:\n${result.stdout}`);

    // Parse the output to find remote bookmarks
    // JJ output format can vary, let's be more flexible with parsing
    const lines = result.stdout.trim().split("\n");
    for (const line of lines) {
      console.log(`Parsing line: "${line}"`);

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
        console.log(
          `Found remote bookmark: ${remoteMatch[1]}@${remoteMatch[2]} -> ${remoteMatch[3]}`,
        );
        return {
          name: remoteMatch[1],
          remote: remoteMatch[2],
          commit_id: remoteMatch[3],
        };
      }
    }

    return null;
  } catch (error) {
    console.log(`No remote bookmark found for ${bookmarkName}:`, error);
    return null;
  }
}

/**
 * Extract GitHub owner and repo from jj git remote URL
 */
async function getGitHubRepoInfo(): Promise<{ owner: string; repo: string }> {
  try {
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
  } catch (error) {
    throw new Error(
      `Failed to get GitHub repository info: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Get the GitHub configuration from environment or config
 */
async function getGitHubConfig(): Promise<GitHubConfig> {
  // Get authentication using the new auth utility
  const authConfig = await getGitHubAuth();
  console.log(`🔑 Using GitHub authentication from: ${authConfig.source}`);

  const octokit = new Octokit({ auth: authConfig.token });

  // Try to extract owner/repo from git remote, fall back to environment variables
  let owner = process.env.GITHUB_OWNER;
  let repo = process.env.GITHUB_REPO;

  if (!owner || !repo) {
    try {
      const repoInfo = await getGitHubRepoInfo();
      owner = repoInfo.owner;
      repo = repoInfo.repo;
      console.log(`📍 Detected GitHub repository: ${owner}/${repo}`);
    } catch (error) {
      console.error("Could not auto-detect GitHub repository:", error);
      throw new Error(
        "Could not auto-detect GitHub repository. Please set GITHUB_OWNER and GITHUB_REPO environment variables",
      );
    }
  }

  return { owner, repo, octokit };
}

/**
 * Check if a PR already exists for the given branch
 */
async function findExistingPR(
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
  } catch (error) {
    console.error("Error checking for existing PR:", error);
    return null;
  }
}

/**
 * Get the default branch name for the repository by finding what trunk() resolves to
 */
async function getDefaultBranch(): Promise<string> {
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
          console.log(`Found default branch: ${name}`);
          return name;
        }
      }
    }

    // If no common names found, try to use the first remote bookmark
    for (const line of lines) {
      const match = line.match(/^([^@\s:]+)@(\w+)/);
      if (match) {
        console.log(`Using first remote bookmark as default: ${match[1]}`);
        return match[1];
      }
    }

    // Final fallback
    console.log("No remote bookmarks found, defaulting to 'main'");
    return "main";
  } catch (error) {
    console.log("Error getting default branch, defaulting to 'main':", error);
    return "main";
  }
}

/**
 * Get the base branch for a bookmark based on what it's stacked on
 */
async function getBaseBranch(bookmarkName: string): Promise<string> {
  try {
    console.log(`🔍 Determining base branch for ${bookmarkName}...`);
    const changeGraph = await buildChangeGraph();

    // Find the bookmark in our change graph
    for (const stack of changeGraph.stacks) {
      for (let i = 0; i < stack.segments.length; i++) {
        const segment = stack.segments[i];
        if (segment.bookmark.name === bookmarkName) {
          console.log(
            `Found ${bookmarkName} in stack at position ${i}/${stack.segments.length}`,
          );

          // If this is the first segment in the stack, it's based on the default branch
          if (i === 0) {
            const defaultBranch = await getDefaultBranch();
            console.log(
              `📌 ${bookmarkName} is the first in stack, using default branch: ${defaultBranch}`,
            );
            return defaultBranch;
          }

          // Otherwise, it's based on the previous segment's bookmark
          const previousSegment = stack.segments[i - 1];
          console.log(
            `📌 ${bookmarkName} is stacked on: ${previousSegment.bookmark.name}`,
          );
          return previousSegment.bookmark.name;
        }
      }
    }

    // If not found in stacks, it's a standalone bookmark - use default branch
    const defaultBranch = await getDefaultBranch();
    console.log(
      `📌 ${bookmarkName} not found in stacks, using default branch: ${defaultBranch}`,
    );
    return defaultBranch;
  } catch (error) {
    console.error("Error determining base branch, defaulting to main:", error);
    return "main";
  }
}

/**
 * Generate PR title and body from the bookmark's commits
 */
async function generatePRContent(
  bookmarkName: string,
): Promise<{ title: string; body: string }> {
  try {
    console.log(`📝 Generating PR content for ${bookmarkName}...`);
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
      segmentChanges[0].description_first_line || `Add ${bookmarkName}`;

    // Generate more detailed body
    let body = `## Changes in \`${bookmarkName}\`\n\n`;

    if (segmentChanges.length === 1) {
      body += `This PR contains a single commit:\n\n`;
    } else {
      body += `This PR contains ${segmentChanges.length} commits:\n\n`;
    }

    for (let i = 0; i < segmentChanges.length; i++) {
      const change = segmentChanges[i];
      body += `${i + 1}. **${change.description_first_line}**\n`;
      body += `   \`${change.commit_id}\` by ${change.author_name}\n\n`;
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

    console.log(`✅ Generated PR title: "${title}"`);
    return { title, body };
  } catch (error) {
    console.error("Error generating PR content:", error);
    return {
      title: `Add ${bookmarkName}`,
      body: `Changes from bookmark ${bookmarkName}`,
    };
  }
}

/**
 * Push the bookmark to the remote
 */
async function pushBookmark(
  bookmarkName: string,
  remote: string = "origin",
  dryRun: boolean = false,
): Promise<void> {
  if (dryRun) {
    console.log(`[DRY RUN] Would push ${bookmarkName} to ${remote}`);
    return;
  }

  try {
    console.log(`Pushing ${bookmarkName} to ${remote}...`);
    await execFileAsync(JJ_BINARY, [
      "git",
      "push",
      "--remote",
      remote,
      "--bookmark",
      bookmarkName,
      "--allow-new",
    ]);
    console.log(`✅ Successfully pushed ${bookmarkName} to ${remote}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to push ${bookmarkName}: ${errorMessage}`);
  }
}

/**
 * Create a new PR
 */
async function createPR(
  octokit: Octokit,
  owner: string,
  repo: string,
  bookmarkName: string,
  baseBranch: string,
  title: string,
  body: string,
): Promise<PullRequest> {
  try {
    console.log(`Creating PR: ${bookmarkName} -> ${baseBranch}`);
    const result = await octokit.rest.pulls.create({
      owner,
      repo,
      title,
      body,
      head: bookmarkName,
      base: baseBranch,
    });

    return result.data;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to create PR: ${errorMessage}`);
  }
}

/**
 * Validate that a bookmark exists locally
 */
async function validateBookmark(bookmarkName: string): Promise<void> {
  try {
    const result = await execFileAsync(JJ_BINARY, [
      "bookmark",
      "list",
      bookmarkName,
    ]);

    if (!result.stdout.trim()) {
      throw new Error(`Bookmark '${bookmarkName}' does not exist locally`);
    }

    console.log(`✅ Found local bookmark: ${bookmarkName}`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to validate bookmark '${bookmarkName}': ${errorMessage}`,
    );
  }
}

/**
 * Get all bookmarks in the stack that need to be submitted (including the target bookmark)
 */
async function getStackBookmarksToSubmit(
  bookmarkName: string,
): Promise<string[]> {
  try {
    console.log(`🔍 Finding all bookmarks in stack for ${bookmarkName}...`);
    const changeGraph = await buildChangeGraph();

    // Find which stack contains the target bookmark
    for (const stack of changeGraph.stacks) {
      const targetIndex = stack.segments.findIndex(
        (segment) => segment.bookmark.name === bookmarkName,
      );

      if (targetIndex !== -1) {
        // Return all bookmarks from root up to and including the target
        const bookmarksToSubmit = stack.segments
          .slice(0, targetIndex + 1)
          .map((segment) => segment.bookmark.name);

        console.log(
          `📚 Found stack bookmarks to submit: ${bookmarksToSubmit.join(" -> ")}`,
        );
        return bookmarksToSubmit;
      }
    }

    // If not found in any stack, it's a standalone bookmark
    console.log(
      `� ${bookmarkName} is standalone, submitting just this bookmark`,
    );
    return [bookmarkName];
  } catch (error) {
    console.error("Error finding stack bookmarks:", error);
    // Fallback to just the target bookmark
    return [bookmarkName];
  }
}

/**
 * Check if all bookmarks in the list have remote versions
 */
async function checkRemoteBookmarks(
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
 * Check for existing PRs for all bookmarks
 */
async function checkExistingPRs(
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
 * Main submit command function
 */
export async function submitCommand(
  bookmarkName: string,
  options: SubmitOptions = {},
): Promise<void> {
  const { dryRun = false } = options;

  if (dryRun) {
    console.log(
      `🧪 DRY RUN: Simulating submission of bookmark: ${bookmarkName}`,
    );
  } else {
    console.log(`🚀 Submitting bookmark: ${bookmarkName}`);
  }

  try {
    // 0. Validate target bookmark exists locally
    await validateBookmark(bookmarkName);
    console.log(`✅ Found local bookmark: ${bookmarkName}`);

    // 1. Get all bookmarks in the stack that need to be submitted
    const bookmarksToSubmit = await getStackBookmarksToSubmit(bookmarkName);

    // 2. Get GitHub configuration
    const repoInfo = await getGitHubRepoInfo();
    console.log(`📍 GitHub repository: ${repoInfo.owner}/${repoInfo.repo}`);

    // Get GitHub configuration (includes authentication)
    const githubConfig = await getGitHubConfig();
    const { octokit } = githubConfig;

    // 3. Check status of all bookmarks
    console.log(
      `\n🔍 Checking status of ${bookmarksToSubmit.length} bookmarks...`,
    );
    const remoteBookmarks = await checkRemoteBookmarks(bookmarksToSubmit);

    // Check existing PRs (needed for both dry-run and normal execution)
    const existingPRs = await checkExistingPRs(
      octokit,
      githubConfig.owner,
      githubConfig.repo,
      bookmarksToSubmit,
    );

    // 4. Determine what actions are needed
    const bookmarksNeedingPush: string[] = [];
    const bookmarksNeedingPR: string[] = [];

    for (const bookmark of bookmarksToSubmit) {
      const hasRemote = remoteBookmarks.get(bookmark);
      const hasExistingPR = existingPRs.get(bookmark);

      if (!hasRemote) {
        bookmarksNeedingPush.push(bookmark);
      }

      if (!hasExistingPR) {
        bookmarksNeedingPR.push(bookmark);
      }

      console.log(
        `📋 ${bookmark}: ${hasRemote ? "has remote" : "needs push"}, ${hasExistingPR ? "has PR" : "needs PR"}`,
      );
    }

    if (dryRun) {
      console.log("\n🧪 DRY RUN - Simulating all operations:");
      console.log("=".repeat(50));
    }

    // 5. Execute submission (with dry-run protection in individual functions)

    // First, push all bookmarks that need pushing
    if (bookmarksNeedingPush.length > 0) {
      if (dryRun) {
        console.log(
          `\n� Would push ${bookmarksNeedingPush.length} bookmarks to remote:`,
        );
      } else {
        console.log(
          `\n📤 Pushing ${bookmarksNeedingPush.length} bookmarks to remote...`,
        );
      }
      for (const bookmark of bookmarksNeedingPush) {
        await pushBookmark(bookmark, "origin", dryRun);
      }
    }

    // Then create PRs for bookmarks that need them (in order from bottom to top)
    if (bookmarksNeedingPR.length > 0) {
      if (dryRun) {
        console.log(`\n📝 Would create ${bookmarksNeedingPR.length} PRs:`);
        for (const bookmark of bookmarksNeedingPR) {
          const baseBranch = await getBaseBranch(bookmark);
          const { title } = await generatePRContent(bookmark);
          console.log(`   • ${bookmark}: "${title}" (base: ${baseBranch})`);
        }
      } else {
        console.log(`\n📝 Creating ${bookmarksNeedingPR.length} PRs...`);
        for (const bookmark of bookmarksNeedingPR) {
          const baseBranch = await getBaseBranch(bookmark);
          const { title, body } = await generatePRContent(bookmark);

          const pr = await createPR(
            octokit,
            githubConfig.owner,
            githubConfig.repo,
            bookmark,
            baseBranch,
            title,
            body,
          );

          console.log(`✅ Created PR for ${bookmark}: ${pr.html_url}`);
          console.log(`   Title: ${pr.title}`);
          console.log(`   Base: ${pr.base.ref} <- Head: ${pr.head.ref}`);
        }
      }
    }

    if (dryRun) {
      console.log("=".repeat(50));
      console.log(`✅ Dry run completed successfully!`);
    } else {
      console.log(`\n🎉 Successfully submitted stack up to ${bookmarkName}!`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Submit command failed: ${errorMessage}`);
  }
}
