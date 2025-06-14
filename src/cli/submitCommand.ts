import {
  analyzeSubmissionPlan,
  executeSubmissionPlan,
  getGitHubConfig,
  type SubmissionCallbacks,
  type SubmissionPlan,
  type RemoteBookmark,
  type PullRequest,
} from "../lib/submitUtils.js";
import type { Octokit } from "octokit";

// Use Octokit's built-in types
type PullRequestListItem = Awaited<
  ReturnType<Octokit["rest"]["pulls"]["list"]>
>["data"][0];

interface SubmitOptions {
  dryRun?: boolean;
}

/**
 * Format bookmark status for display
 */
function formatBookmarkStatus(
  bookmark: string,
  remoteBookmarks: Map<string, RemoteBookmark | null>,
  existingPRs: Map<string, PullRequestListItem | null>,
): string {
  const hasRemote = remoteBookmarks.get(bookmark);
  const hasExistingPR = existingPRs.get(bookmark);

  return `📋 ${bookmark}: ${hasRemote ? "has remote" : "needs push"}, ${hasExistingPR ? "has PR" : "needs PR"}`;
}

/**
 * Create submission callbacks for console output
 */
function createSubmissionCallbacks(
  dryRun: boolean = false,
): SubmissionCallbacks {
  return {
    onBookmarkValidated: (bookmark: string) => {
      console.log(`✅ Found local bookmark: ${bookmark}`);
    },

    onAnalyzingStack: (targetBookmark: string) => {
      console.log(`🔍 Finding all bookmarks in stack for ${targetBookmark}...`);
    },

    onStackFound: (bookmarks: string[]) => {
      console.log(
        `📚 Found stack bookmarks to submit: ${bookmarks.join(" -> ")}`,
      );
    },

    onCheckingRemotes: (bookmarks: string[]) => {
      console.log(`\n🔍 Checking status of ${bookmarks.length} bookmarks...`);
    },

    onCheckingPRs: () => {
      // This happens as part of checking status, no need for separate message
    },

    onPlanReady: (plan: SubmissionPlan) => {
      console.log(
        `📍 GitHub repository: ${plan.repoInfo.owner}/${plan.repoInfo.repo}`,
      );

      // Show status of all bookmarks
      for (const bookmark of plan.bookmarksToSubmit) {
        console.log(
          formatBookmarkStatus(
            bookmark,
            plan.remoteBookmarks,
            plan.existingPRs,
          ),
        );
      }

      if (dryRun) {
        console.log("\n🧪 DRY RUN - Simulating all operations:");
        console.log("=".repeat(50));

        if (plan.bookmarksNeedingPush.length > 0) {
          console.log(
            `\n🛜 Would push ${plan.bookmarksNeedingPush.length} bookmarks to remote:`,
          );
          for (const bookmark of plan.bookmarksNeedingPush) {
            console.log(`   • ${bookmark}`);
          }
        }

        if (plan.bookmarksNeedingPR.length > 0) {
          console.log(
            `\n📝 Would create ${plan.bookmarksNeedingPR.length} PRs:`,
          );
          for (const bookmark of plan.bookmarksNeedingPR) {
            console.log(
              `   • ${bookmark.bookmark}: "${bookmark.prContent.title}" (base: ${bookmark.baseBranch})`,
            );
          }
        }
      } else {
        if (plan.bookmarksNeedingPush.length > 0) {
          console.log(
            `\n📤 Pushing ${plan.bookmarksNeedingPush.length} bookmarks to remote...`,
          );
        }
        if (plan.bookmarksNeedingPR.length > 0) {
          console.log(`\n📝 Creating ${plan.bookmarksNeedingPR.length} PRs...`);
        }
      }
    },

    onPushStarted: (bookmark: string, remote: string) => {
      if (dryRun) {
        console.log(`[DRY RUN] Would push ${bookmark} to ${remote}`);
      } else {
        console.log(`Pushing ${bookmark} to ${remote}...`);
      }
    },

    onPushCompleted: (bookmark: string, remote: string) => {
      if (!dryRun) {
        console.log(`✅ Successfully pushed ${bookmark} to ${remote}`);
      }
    },

    onPRStarted: (bookmark: string, title: string, base: string) => {
      if (dryRun) {
        console.log(`   • ${bookmark}: "${title}" (base: ${base})`);
      } else {
        console.log(`Creating PR: ${bookmark} -> ${base}`);
        console.log(`   Title: "${title}"`);
      }
    },

    onPRCompleted: (bookmark: string, pr: PullRequest) => {
      if (!dryRun) {
        console.log(`✅ Created PR for ${bookmark}: ${pr.html_url}`);
        console.log(`   Title: ${pr.title}`);
        console.log(`   Base: ${pr.base.ref} <- Head: ${pr.head.ref}`);
      }
    },

    onError: (error: Error, context: string) => {
      console.error(`❌ Error ${context}: ${error.message}`);
    },
  };
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
    // Create callbacks for console output
    const callbacks = createSubmissionCallbacks(dryRun);

    // Analyze what needs to be done
    const plan = await analyzeSubmissionPlan(bookmarkName, callbacks);

    // If this is a dry run, we're done after showing the plan
    if (dryRun) {
      console.log("=".repeat(50));
      console.log(`✅ Dry run completed successfully!`);
      return;
    }

    // Get GitHub configuration for execution
    const githubConfig = await getGitHubConfig();
    console.log(
      `🔑 Using GitHub authentication from: ${githubConfig.octokit ? "configured" : "unknown"}`,
    );

    // Execute the plan
    const result = await executeSubmissionPlan(plan, githubConfig, callbacks);

    if (result.success) {
      console.log(`\n🎉 Successfully submitted stack up to ${bookmarkName}!`);

      if (result.pushedBookmarks.length > 0) {
        console.log(`   📤 Pushed: ${result.pushedBookmarks.join(", ")}`);
      }

      if (result.createdPRs.length > 0) {
        console.log(
          `   📝 Created PRs: ${result.createdPRs.map((pr) => pr.bookmark).join(", ")}`,
        );
      }
    } else {
      console.error(`\n❌ Submission completed with errors:`);
      for (const { error, context } of result.errors) {
        console.error(`   • ${context}: ${error.message}`);
      }
      process.exit(1);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`❌ Submit command failed: ${errorMessage}`);
    process.exit(1);
  }
}
