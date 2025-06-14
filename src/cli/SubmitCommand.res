@module("process") external exit: int => unit = "exit"

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

type bookmarkNeedingPRBaseUpdate = {
  bookmark: string,
  currentBaseBranch: string,
  expectedBaseBranch: string,
  pr: pullRequest,
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
  bookmarksNeedingPRBaseUpdate: array<bookmarkNeedingPRBaseUpdate>,
  repoInfo: repoInfo,
  existingPRs: Map.t<string, option<pullRequest>>,
  remoteBookmarks: Map.t<string, option<remoteBookmark>>,
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
  onPRBaseUpdateStarted: option<(string, string, string) => unit>,
  onPRBaseUpdateCompleted: option<(string, pullRequest) => unit>,
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
  createdPRs: array<createdPr>,
  errors: array<errorWithContext>,
}

@module("../lib/submit.js")
external analyzeSubmissionPlan: (string, option<submissionCallbacks>) => promise<submissionPlan> =
  "analyzeSubmissionPlan"

@module("../lib/submit.js")
external executeSubmissionPlan: (
  submissionPlan,
  'githubConfig,
  option<submissionCallbacks>,
) => promise<submissionResult> = "executeSubmissionPlan"

@module("../lib/submit.js")
external getGitHubConfig: unit => promise<'githubConfig> = "getGitHubConfig"

type submitOptions = {dryRun?: bool}

/**
 * Format bookmark status for display
 */
let formatBookmarkStatus = (
  bookmark: string,
  remoteBookmarks: Map.t<string, option<remoteBookmark>>,
  existingPRs: Map.t<string, option<pullRequest>>,
): string => {
  let hasRemote = Map.get(remoteBookmarks, bookmark)
  let hasExistingPR = Map.get(existingPRs, bookmark)

  `📋 ${bookmark}: ${hasRemote->Option.isSome
      ? "has remote"
      : "needs push"}, ${hasExistingPR->Option.isSome ? "has PR" : "needs PR"}`
}

/**
 * Create submission callbacks for console output
 */
let createSubmissionCallbacks = (~dryRun: bool): submissionCallbacks => {
  {
    onBookmarkValidated: Some(
      (bookmark: string) => {
        Console.log(`✅ Found local bookmark: ${bookmark}`)
      },
    ),
    onAnalyzingStack: Some(
      (targetBookmark: string) => {
        Console.log(`🔍 Finding all bookmarks in stack for ${targetBookmark}...`)
      },
    ),
    onStackFound: Some(
      (bookmarks: array<string>) => {
        Console.log(`📚 Found stack bookmarks to submit: ${bookmarks->Array.join(" -> ")}`)
      },
    ),
    onCheckingRemotes: Some(
      (bookmarks: array<string>) => {
        Console.log(
          `\n🔍 Checking status of ${bookmarks->Array.length->Int.toString} bookmarks...`,
        )
      },
    ),
    onCheckingPRs: Some(
      (_bookmarks: array<string>) => {
        // This happens as part of checking status, no need for separate message
        ()
      },
    ),
    onPlanReady: Some(
      (plan: submissionPlan) => {
        Console.log(`📍 GitHub repository: ${plan.repoInfo.owner}/${plan.repoInfo.repo}`)

        // Show status of all bookmarks
        plan.bookmarksToSubmit->Array.forEach(bookmark => {
          Console.log(formatBookmarkStatus(bookmark, plan.remoteBookmarks, plan.existingPRs))
        })

        if dryRun {
          Console.log("\n🧪 DRY RUN - Simulating all operations:")
          Console.log("="->String.repeat(50))

          if plan.bookmarksNeedingPush->Array.length > 0 {
            Console.log(
              `\n🛜 Would push ${plan.bookmarksNeedingPush
                ->Array.length
                ->Int.toString} bookmarks to remote:`,
            )
            plan.bookmarksNeedingPush->Array.forEach(bookmark => {
              Console.log(`   • ${bookmark}`)
            })
          }

          if plan.bookmarksNeedingPR->Array.length > 0 {
            Console.log(
              `\n📝 Would create ${plan.bookmarksNeedingPR->Array.length->Int.toString} PRs:`,
            )
            plan.bookmarksNeedingPR->Array.forEach(bookmark => {
              Console.log(
                `   • ${bookmark.bookmark}: "${bookmark.prContent.title}" (base: ${bookmark.baseBranch})`,
              )
            })
          }

          if plan.bookmarksNeedingPRBaseUpdate->Array.length > 0 {
            Console.log(
              `\n🔄 Would update ${plan.bookmarksNeedingPRBaseUpdate
                ->Array.length
                ->Int.toString} PR bases:`,
            )
            plan.bookmarksNeedingPRBaseUpdate->Array.forEach(update => {
              Console.log(
                `   • ${update.bookmark}: from ${update.currentBaseBranch} to ${update.expectedBaseBranch}`,
              )
            })
          }
        } else {
          if plan.bookmarksNeedingPush->Array.length > 0 {
            Console.log(
              `\n📤 Pushing ${plan.bookmarksNeedingPush
                ->Array.length
                ->Int.toString} bookmarks to remote...`,
            )
          }
          if plan.bookmarksNeedingPR->Array.length > 0 {
            Console.log(
              `\n📝 Creating ${plan.bookmarksNeedingPR->Array.length->Int.toString} PRs...`,
            )
          }
        }
      },
    ),
    onPushStarted: Some(
      (bookmark: string, remote: string) => {
        Console.log(`Pushing ${bookmark} to ${remote}...`)
      },
    ),
    onPushCompleted: Some(
      (bookmark: string, remote: string) => {
        Console.log(`✅ Successfully pushed ${bookmark} to ${remote}`)
      },
    ),
    onPRStarted: Some(
      (bookmark: string, title: string, base: string) => {
        Console.log(`Creating PR: ${bookmark} -> ${base}`)
        Console.log(`   Title: "${title}"`)
      },
    ),
    onPRCompleted: Some(
      (bookmark: string, pr: pullRequest) => {
        Console.log(`✅ Created PR for ${bookmark}: ${pr.html_url}`)
        Console.log(`   Title: ${pr.title}`)
        Console.log(`   Base: ${pr.base.ref} <- Head: ${pr.head.ref}`)
      },
    ),
    onPRBaseUpdateStarted: Some(
      (bookmark: string, currentBase: string, expectedBase: string) => {
        Console.log(`Updating PR base for ${bookmark} from ${currentBase} to ${expectedBase}...`)
      },
    ),
    onPRBaseUpdateCompleted: Some(
      (bookmark: string, pr: pullRequest) => {
        Console.log(`✅ Updated PR base for ${bookmark}: ${pr.html_url}`)
        Console.log(`   New Base: ${pr.base.ref} <- Head: ${pr.head.ref}`)
      },
    ),
    onError: Some(
      (error: Exn.t, context: string) => {
        let errorMessage = error->Exn.message->Option.getOr("Unknown error")
        Console.error(`❌ Error ${context}: ${errorMessage}`)
      },
    ),
  }
}

/**
 * Main submit command function
 */
let submitCommand = async (bookmarkName: string, ~options: option<submitOptions>=?): unit => {
  let dryRun = switch options {
  | Some({?dryRun}) => dryRun->Option.getOr(false)
  | None => false
  }

  if dryRun {
    Console.log(`🧪 DRY RUN: Simulating submission of bookmark: ${bookmarkName}`)
  } else {
    Console.log(`🚀 Submitting bookmark: ${bookmarkName}`)
  }

  // Create callbacks for console output
  let callbacks = createSubmissionCallbacks(~dryRun)

  // Analyze what needs to be done
  let plan = await analyzeSubmissionPlan(bookmarkName, Some(callbacks))

  // If this is a dry run, we're done after showing the plan
  if dryRun {
    Console.log("="->String.repeat(50))
    Console.log(`✅ Dry run completed successfully!`)
  } else {
    // Get GitHub configuration for execution
    let githubConfig = await getGitHubConfig()
    Console.log(`🔑 Using GitHub authentication from: configured`)

    // Execute the plan
    let result = await executeSubmissionPlan(plan, githubConfig, Some(callbacks))

    if result.success {
      Console.log(`\n🎉 Successfully submitted stack up to ${bookmarkName}!`)

      if result.pushedBookmarks->Array.length > 0 {
        Console.log(`   📤 Pushed: ${result.pushedBookmarks->Array.join(", ")}`)
      }

      if result.createdPRs->Array.length > 0 {
        let createdPrBookmarks = result.createdPRs->Array.map(pr => pr.bookmark)
        Console.log(`   📝 Created PRs: ${createdPrBookmarks->Array.join(", ")}`)
      }
    } else {
      Console.error(`\n❌ Submission completed with errors:`)
      result.errors->Array.forEach(({error: err, context}) => {
        let errorMessage = err->Exn.message->Option.getOr("Unknown error")
        Console.error(`   • ${context}: ${errorMessage}`)
      })
      exit(1)
    }
  }
}
