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

@module("../lib/submitUtils.js")
external executeSubmissionPlan: (
  submissionPlan,
  'githubConfig,
  option<submissionCallbacks>,
) => promise<submissionResult> = "executeSubmissionPlan"

@module("../lib/submitUtils.js")
external getGitHubConfig: unit => promise<'githubConfig> = "getGitHubConfig"

// Console module
@module("console") external log: string => unit = "log"
@module("console") external error: string => unit = "error"

// Process module
@module("process") external exit: int => unit = "exit"

// String methods
@send external repeat: (string, int) => string = "repeat"
@send external join: (array<string>, string) => string = "join"

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
let createSubmissionCallbacks = (~dryRun: bool=false, ()): submissionCallbacks => {
  {
    onBookmarkValidated: Some(
      (bookmark: string) => {
        log(`✅ Found local bookmark: ${bookmark}`)
      },
    ),
    onAnalyzingStack: Some(
      (targetBookmark: string) => {
        log(`🔍 Finding all bookmarks in stack for ${targetBookmark}...`)
      },
    ),
    onStackFound: Some(
      (bookmarks: array<string>) => {
        log(`📚 Found stack bookmarks to submit: ${bookmarks->join(" -> ")}`)
      },
    ),
    onCheckingRemotes: Some(
      (bookmarks: array<string>) => {
        log(`\n🔍 Checking status of ${bookmarks->Array.length->Int.toString} bookmarks...`)
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
        log(`📍 GitHub repository: ${plan.repoInfo.owner}/${plan.repoInfo.repo}`)

        // Show status of all bookmarks
        plan.bookmarksToSubmit->Array.forEach(bookmark => {
          log(formatBookmarkStatus(bookmark, plan.remoteBookmarks, plan.existingPRs))
        })

        if dryRun {
          log("\n🧪 DRY RUN - Simulating all operations:")
          log("="->repeat(50))

          if plan.bookmarksNeedingPush->Array.length > 0 {
            log(
              `\n🛜 Would push ${plan.bookmarksNeedingPush
                ->Array.length
                ->Int.toString} bookmarks to remote:`,
            )
            plan.bookmarksNeedingPush->Array.forEach(bookmark => {
              log(`   • ${bookmark}`)
            })
          }

          if plan.bookmarksNeedingPR->Array.length > 0 {
            log(`\n📝 Would create ${plan.bookmarksNeedingPR->Array.length->Int.toString} PRs:`)
            plan.bookmarksNeedingPR->Array.forEach(bookmark => {
              log(
                `   • ${bookmark.bookmark}: "${bookmark.prContent.title}" (base: ${bookmark.baseBranch})`,
              )
            })
          }
        } else {
          if plan.bookmarksNeedingPush->Array.length > 0 {
            log(
              `\n📤 Pushing ${plan.bookmarksNeedingPush
                ->Array.length
                ->Int.toString} bookmarks to remote...`,
            )
          }
          if plan.bookmarksNeedingPR->Array.length > 0 {
            log(`\n📝 Creating ${plan.bookmarksNeedingPR->Array.length->Int.toString} PRs...`)
          }
        }
      },
    ),
    onPushStarted: Some(
      (bookmark: string, remote: string) => {
        if dryRun {
          log(`[DRY RUN] Would push ${bookmark} to ${remote}`)
        } else {
          log(`Pushing ${bookmark} to ${remote}...`)
        }
      },
    ),
    onPushCompleted: Some(
      (bookmark: string, remote: string) => {
        if !dryRun {
          log(`✅ Successfully pushed ${bookmark} to ${remote}`)
        }
      },
    ),
    onPRStarted: Some(
      (bookmark: string, title: string, base: string) => {
        if dryRun {
          log(`   • ${bookmark}: "${title}" (base: ${base})`)
        } else {
          log(`Creating PR: ${bookmark} -> ${base}`)
          log(`   Title: "${title}"`)
        }
      },
    ),
    onPRCompleted: Some(
      (bookmark: string, pr: pullRequest) => {
        if !dryRun {
          log(`✅ Created PR for ${bookmark}: ${pr.html_url}`)
          log(`   Title: ${pr.title}`)
          log(`   Base: ${pr.base.ref} <- Head: ${pr.head.ref}`)
        }
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
    log(`🧪 DRY RUN: Simulating submission of bookmark: ${bookmarkName}`)
  } else {
    log(`🚀 Submitting bookmark: ${bookmarkName}`)
  }

  // Create callbacks for console output
  let callbacks = createSubmissionCallbacks(~dryRun, ())

  // Analyze what needs to be done
  let plan = await analyzeSubmissionPlan(bookmarkName, Some(callbacks))

  // If this is a dry run, we're done after showing the plan
  if dryRun {
    log("="->repeat(50))
    log(`✅ Dry run completed successfully!`)
  } else {
    // Get GitHub configuration for execution
    let githubConfig = await getGitHubConfig()
    log(`🔑 Using GitHub authentication from: configured`)

    // Execute the plan
    let result = await executeSubmissionPlan(plan, githubConfig, Some(callbacks))

    if result.success {
      log(`\n🎉 Successfully submitted stack up to ${bookmarkName}!`)

      if result.pushedBookmarks->Array.length > 0 {
        log(`   📤 Pushed: ${result.pushedBookmarks->join(", ")}`)
      }

      if result.createdPrs->Array.length > 0 {
        let createdPrBookmarks = result.createdPrs->Array.map(pr => pr.bookmark)
        log(`   📝 Created PRs: ${createdPrBookmarks->join(", ")}`)
      }
    } else {
      error(`\n❌ Submission completed with errors:`)
      result.errors->Array.forEach(({error: err, context}) => {
        let errorMessage = err->Exn.message->Option.getOr("Unknown error")
        error(`   • ${context}: ${errorMessage}`)
      })
      exit(1)
    }
  }
}
