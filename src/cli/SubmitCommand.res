@module("process") external exit: int => unit = "exit"

type prContent = {title: string}

type bookmarkNeedingPR = {
  bookmark: JJTypes.bookmark,
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
  bookmark: JJTypes.bookmark,
  currentBaseBranch: string,
  expectedBaseBranch: string,
  pr: pullRequest,
}

type submissionPlan = {
  targetBookmark: string,
  bookmarksToSubmit: array<JJTypes.bookmark>,
  bookmarksNeedingPush: array<JJTypes.bookmark>,
  bookmarksNeedingPR: array<bookmarkNeedingPR>,
  bookmarksNeedingPRBaseUpdate: array<bookmarkNeedingPRBaseUpdate>,
  repoInfo: repoInfo,
  existingPRs: Map.t<string, option<pullRequest>>,
}

type submissionCallbacks = {
  onBookmarkValidated: option<string => unit>,
  onAnalyzingStack: option<string => unit>,
  onStackFound: option<array<JJTypes.bookmark> => unit>,
  onCheckingPRs: option<array<JJTypes.bookmark> => unit>,
  onPlanReady: option<submissionPlan => unit>,
  onPushStarted: option<(JJTypes.bookmark, string) => unit>,
  onPushCompleted: option<(JJTypes.bookmark, string) => unit>,
  onPRStarted: option<(JJTypes.bookmark, string, string) => unit>,
  onPRCompleted: option<(JJTypes.bookmark, pullRequest) => unit>,
  onPRBaseUpdateStarted: option<(JJTypes.bookmark, string, string) => unit>,
  onPRBaseUpdateCompleted: option<(JJTypes.bookmark, pullRequest) => unit>,
  onError: option<(Exn.t, string) => unit>,
}

type createdOrUpdatedPr = {
  bookmark: JJTypes.bookmark,
  pr: pullRequest,
}

type errorWithContext = {
  error: Exn.t,
  context: string,
}

type submissionResult = {
  success: bool,
  pushedBookmarks: array<JJTypes.bookmark>,
  createdPRs: array<createdOrUpdatedPr>,
  updatedPRs: array<createdOrUpdatedPr>,
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
  bookmark: JJTypes.bookmark,
  existingPRs: Map.t<string, option<pullRequest>>,
): string => {
  let hasExistingPR = Map.get(existingPRs, bookmark.name)

  `📋 ${bookmark.name}: ${bookmark.hasRemote
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
      (bookmarks: array<JJTypes.bookmark>) => {
        Console.log(
          `📚 Found stack bookmarks to submit: ${bookmarks
            ->Array.map(b => b.name)
            ->Array.join(" -> ")}`,
        )
      },
    ),
    onCheckingPRs: Some(
      (_bookmarks: array<JJTypes.bookmark>) => {
        // This happens as part of checking status, no need for separate message
        ()
      },
    ),
    onPlanReady: Some(
      (plan: submissionPlan) => {
        Console.log(`📍 GitHub repository: ${plan.repoInfo.owner}/${plan.repoInfo.repo}`)

        // Show status of all bookmarks
        plan.bookmarksToSubmit->Array.forEach(bookmark => {
          Console.log(formatBookmarkStatus(bookmark, plan.existingPRs))
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
              Console.log(`   • ${bookmark.name}`)
            })
          }

          if plan.bookmarksNeedingPR->Array.length > 0 {
            Console.log(
              `\n📝 Would create ${plan.bookmarksNeedingPR->Array.length->Int.toString} PRs:`,
            )
            plan.bookmarksNeedingPR->Array.forEach(create => {
              Console.log(
                `   • ${create.bookmark.name}: "${create.prContent.title}" (base: ${create.baseBranch})`,
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
                `   • ${update.bookmark.name}: from ${update.currentBaseBranch} to ${update.expectedBaseBranch}`,
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
      (bookmark: JJTypes.bookmark, remote: string) => {
        Console.log(`Pushing ${bookmark.name} to ${remote}...`)
      },
    ),
    onPushCompleted: Some(
      (bookmark: JJTypes.bookmark, remote: string) => {
        Console.log(`✅ Successfully pushed ${bookmark.name} to ${remote}`)
      },
    ),
    onPRStarted: Some(
      (bookmark: JJTypes.bookmark, title: string, base: string) => {
        Console.log(`Creating PR: ${bookmark.name} -> ${base}`)
        Console.log(`   Title: "${title}"`)
      },
    ),
    onPRCompleted: Some(
      (bookmark: JJTypes.bookmark, pr: pullRequest) => {
        Console.log(`✅ Created PR for ${bookmark.name}: ${pr.html_url}`)
        Console.log(`   Title: ${pr.title}`)
        Console.log(`   Base: ${pr.base.ref} <- Head: ${pr.head.ref}`)
      },
    ),
    onPRBaseUpdateStarted: Some(
      (bookmark: JJTypes.bookmark, currentBase: string, expectedBase: string) => {
        Console.log(
          `Updating PR base for ${bookmark.name} from ${currentBase} to ${expectedBase}...`,
        )
      },
    ),
    onPRBaseUpdateCompleted: Some(
      (bookmark: JJTypes.bookmark, pr: pullRequest) => {
        Console.log(`✅ Updated PR base for ${bookmark.name}: ${pr.html_url}`)
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
        Console.log(
          `   📤 Pushed: ${result.pushedBookmarks->Array.map(b => b.name)->Array.join(", ")}`,
        )
      }

      if result.createdPRs->Array.length > 0 {
        let createdPrBookmarks = result.createdPRs->Array.map(pr => pr.bookmark.name)
        Console.log(`   📝 Created PRs: ${createdPrBookmarks->Array.join(", ")}`)
      }

      if result.updatedPRs->Array.length > 0 {
        let updatedPrBookmarks = result.updatedPRs->Array.map(pr => pr.bookmark.name)
        Console.log(`   🔄 Updated PRs: ${updatedPrBookmarks->Array.join(", ")}`)
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
