type octoKit = {}

type gitHubConfig = {
  owner: string,
  repo: string,
  octokit: octoKit,
}

@module("../lib/jjUtils.js")
external buildChangeGraph: unit => promise<JJTypes.changeGraph> = "buildChangeGraph"
@module("../lib/jjUtils.js")
external gitFetch: unit => promise<unit> = "gitFetch"
@module("../lib/submit.js")
external getExistingPRs: (
  octoKit,
  string,
  string,
  array<string>,
) => promise<Map.t<string, SubmitCommand.pullRequest>> = "getExistingPRs"
@module("../lib/submit.js")
external getGitHubConfig: unit => promise<gitHubConfig> = "getGitHubConfig"

@module("ink") external render: React.element => unit = "render"

let analyzeCommand = async () => {
  Console.log("Fetching from remote...")
  try {
    await gitFetch()
  } catch {
  | Exn.Error(error) =>
    Console.error(
      "Error fetching from remote: " ++ error->Exn.message->Option.getOr("Unknown error"),
    )
  }

  Console.log("Building change graph from user bookmarks...")
  let changeGraph = await buildChangeGraph()

  let prStatusMap = try {
    Console.log("Getting GitHub configuration...")
    let githubConfig = await getGitHubConfig()

    Console.log("Fetching existing pull requests...")
    await getExistingPRs(
      githubConfig.octokit,
      githubConfig.owner,
      githubConfig.repo,
      changeGraph.bookmarks->Array.map(b => b.name),
    )
  } catch {
  | Exn.Error(error) =>
    Console.error("Error getting GitHub PRs: " ++ error->Exn.message->Option.getOr("Unknown error"))
    Map.make()
  }

  render(<AnalyzeCommandComponent changeGraph prStatusMap />)

  Console.log("\n=== CHANGE GRAPH RESULTS ===")
  Console.log(`Total bookmarks: ${changeGraph.bookmarks->Array.length->Belt.Int.toString}`)
  Console.log(`Total stacks: ${changeGraph.stacks->Array.length->Belt.Int.toString}`)

  if changeGraph.stacks->Array.length > 0 {
    Console.log("\n=== BOOKMARK STACKS ===")
    changeGraph.stacks->Array.forEachWithIndex((stack, i) => {
      Console.log(`\nStack ${(i + 1)->Belt.Int.toString}:`)
      Console.log(
        `  Bookmarks: ${stack.segments
          ->Array.flatMap(s => s.bookmarks->Array.map(b => b.name))
          ->Array.join(", ")}`,
      )

      // Calculate total changes across all segments
      let totalChanges =
        stack.segments->Array.reduce(0, (sum, segment) => sum + segment.changes->Array.length)
      Console.log(`  Total changes: ${totalChanges->Belt.Int.toString}`)

      if stack.segments->Array.length > 1 {
        Console.log("  📚 This is a stacked set of bookmarks!")
      }
    })
  }

  Console.log("\n=== INDIVIDUAL BOOKMARK DETAILS ===")
  changeGraph.segmentChanges->Map.forEachWithKey((segmentChanges, bookmarkName) => {
    Console.log(`\n${bookmarkName}:`)
    Console.log(`  Segment changes: ${segmentChanges->Array.length->Belt.Int.toString}`)
    switch (segmentChanges->Array.at(0), segmentChanges->Array.last) {
    | (Some(first), Some(last)) => {
        Console.log(`  Latest: ${first.descriptionFirstLine}`)
        Console.log(`  Oldest: ${last.descriptionFirstLine}`)
      }
    | _ => ()
    }
  })
}
