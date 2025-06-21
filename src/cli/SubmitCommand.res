@module("process") external exit: int => unit = "exit"
@module("../lib/jjUtils.js")
external buildChangeGraph: unit => promise<JJTypes.changeGraph> = "buildChangeGraph"
@module("../lib/jjUtils.js")
external gitFetch: unit => promise<unit> = "gitFetch"

type prContent = {title: string}

type bookmarkNeedingPR = {
  bookmark: JJTypes.bookmark,
  baseBranchOptions: array<string>,
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
  expectedBaseBranchOptions: array<string>,
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

// AIDEV-NOTE: External bindings for new three-phase submission API

@module("../lib/submit.js")
external analyzeSubmissionGraph: (JJTypes.changeGraph, string) => JJTypes.submissionAnalysis =
  "analyzeSubmissionGraph"

@module("../lib/submit.js")
external createSubmissionPlan: (
  array<JJTypes.narrowedBookmarkSegment>,
  option<'planCallbacks>,
) => promise<submissionPlan> = "createSubmissionPlan"

@module("../lib/submit.js")
external createNarrowedSegments: (
  array<JJTypes.bookmark>,
  JJTypes.submissionAnalysis,
) => array<JJTypes.narrowedBookmarkSegment> = "createNarrowedSegments"

@module("../lib/submit.js")
external executeSubmissionPlan: (
  submissionPlan,
  'githubConfig,
  option<'executionCallbacks>,
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
 * Create execution callbacks for console output during plan execution
 */
let createExecutionCallbacks = (): 'executionCallbacks => {
  {
    "onPushStarted": Some(
      (bookmark: JJTypes.bookmark, remote: string) => {
        Console.log(`Pushing ${bookmark.name} to ${remote}...`)
      },
    ),
    "onPushCompleted": Some(
      (bookmark: JJTypes.bookmark, remote: string) => {
        Console.log(`✅ Successfully pushed ${bookmark.name} to ${remote}`)
      },
    ),
    "onPRStarted": Some(
      (bookmark: JJTypes.bookmark, title: string, base: string) => {
        Console.log(`Creating PR: ${bookmark.name} -> ${base}`)
        Console.log(`   Title: "${title}"`)
      },
    ),
    "onPRCompleted": Some(
      (bookmark: JJTypes.bookmark, pr: pullRequest) => {
        Console.log(`✅ Created PR for ${bookmark.name}: ${pr.html_url}`)
        Console.log(`   Title: ${pr.title}`)
        Console.log(`   Base: ${pr.base.ref} <- Head: ${pr.head.ref}`)
      },
    ),
    "onPRBaseUpdateStarted": Some(
      (bookmark: JJTypes.bookmark, currentBase: string, expectedBase: string) => {
        Console.log(
          `Updating PR base for ${bookmark.name} from ${currentBase} to ${expectedBase}...`,
        )
      },
    ),
    "onPRBaseUpdateCompleted": Some(
      (bookmark: JJTypes.bookmark, pr: pullRequest) => {
        Console.log(`✅ Updated PR base for ${bookmark.name}: ${pr.html_url}`)
        Console.log(`   New Base: ${pr.base.ref} <- Head: ${pr.head.ref}`)
      },
    ),
    "onError": Some(
      (error: Exn.t, context: string) => {
        let errorMessage = error->Exn.message->Option.getOr("Unknown error")
        Console.error(`❌ Error ${context}: ${errorMessage}`)
      },
    ),
  }
}

let runSubmit = async (bookmarkName: string, changeGraph: JJTypes.changeGraph, dryRun: bool) => {
  // PHASE 1: Analyze the submission graph
  Console.log(`🔍 Analyzing submission requirements for: ${bookmarkName}`)
  let analysis = analyzeSubmissionGraph(changeGraph, bookmarkName)

  Console.log(
    `✅ Found stack with ${analysis.relevantSegments->Array.length->Int.toString} segment(s)`,
  )

  // PHASE 2: Resolve bookmark selections (CLI handles user interaction)
  let resolvedBookmarks = await Utils.resolveBookmarkSelections(analysis)

  Console.log(`📋 Creating submission plan...`)
  let narrowedSegments = createNarrowedSegments(resolvedBookmarks, analysis)
  let plan = await createSubmissionPlan(narrowedSegments, None)

  // Display plan summary
  Console.log(`📍 GitHub repository: ${plan.repoInfo.owner}/${plan.repoInfo.repo}`)
  resolvedBookmarks->Array.forEach(bookmark => {
    Console.log(formatBookmarkStatus(bookmark, plan.existingPRs))
  })

  // If this is a dry run, we're done after showing the plan
  if dryRun {
    Console.log("\n🧪 DRY RUN - Simulating all operations:")
    Console.log("="->String.repeat(50))

    if plan.bookmarksNeedingPush->Array.length > 0 {
      Console.log(
        `📤 Would push: ${plan.bookmarksNeedingPush->Array.length->Int.toString} bookmark(s)`,
      )
      plan.bookmarksNeedingPush->Array.forEach(bookmark => {
        Console.log(`   • ${bookmark.name}`)
      })
    }

    if plan.bookmarksNeedingPR->Array.length > 0 {
      Console.log(`📝 Would create: ${plan.bookmarksNeedingPR->Array.length->Int.toString} PR(s)`)
      plan.bookmarksNeedingPR->Array.forEach(item => {
        Console.log(
          `   • ${item.bookmark.name} (base: ${item.baseBranchOptions->Array.join(" or ")})`,
        )
      })
    }

    if plan.bookmarksNeedingPRBaseUpdate->Array.length > 0 {
      Console.log(
        `🔄 Would update: ${plan.bookmarksNeedingPRBaseUpdate
          ->Array.length
          ->Int.toString} PR base(s)`,
      )
      plan.bookmarksNeedingPRBaseUpdate->Array.forEach(item => {
        Console.log(
          `   • ${item.bookmark.name}: ${item.currentBaseBranch} → ${item.expectedBaseBranchOptions->Array.join(
              " or ",
            )}`,
        )
      })
    }

    Console.log("="->String.repeat(50))
    Console.log(`✅ Dry run completed successfully!`)
  } else {
    // PHASE 3: Execute the plan
    Console.log(`🔑 Getting GitHub authentication...`)
    let githubConfig = await getGitHubConfig()

    let executionCallbacks = createExecutionCallbacks()
    let result = await executeSubmissionPlan(plan, githubConfig, Some(executionCallbacks))

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

    Console.log("Fetching from remote...")
    try {
      await gitFetch()
    } catch {
    | Exn.Error(error) =>
      Console.error(
        "Error fetching from remote: " ++ error->Exn.message->Option.getOr("Unknown error"),
      )
    }
  }

  Console.log("Building change graph from user bookmarks...")
  let changeGraph = await buildChangeGraph()

  await runSubmit(bookmarkName, changeGraph, dryRun)
}
