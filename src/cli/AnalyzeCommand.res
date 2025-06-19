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

  let prStatusMap = Map.make()
  // let prStatusMap = try {
  //   Console.log("Getting GitHub configuration...")
  //   let githubConfig = await getGitHubConfig()

  //   Console.log("Fetching existing pull requests...")
  //   await getExistingPRs(
  //     githubConfig.octokit,
  //     githubConfig.owner,
  //     githubConfig.repo,
  //     changeGraph.bookmarks->Map.values->Array.fromIterator->Array.map(b => b.name),
  //   )
  // } catch {
  // | Exn.Error(error) =>
  //   Console.error("Error getting GitHub PRs: " ++ error->Exn.message->Option.getOr("Unknown error"))
  //   Map.make()
  // }

  let inDegrees = Map.make()
  changeGraph.bookmarkedChangeAdjacencyList->Map.forEach(parentChangeId => {
    inDegrees->Map.set(parentChangeId, inDegrees->Map.get(parentChangeId)->Option.getOr(0) + 1)
  })

  let queue =
    changeGraph.stackLeafs
    ->Set.toArray
    ->Array.toSorted((a, b) => {
      let logEntryA = Utils.changeIdToLogEntry(changeGraph, a)
      let logEntryB = Utils.changeIdToLogEntry(changeGraph, b)
      logEntryB.committedAt->Date.getTime -. logEntryA.committedAt->Date.getTime
    })
  let topSort = []
  while queue->Array.length > 0 {
    let changeId = queue->Array.shift->Option.getExn
    topSort->Array.push(changeId)
    let parent = changeGraph.bookmarkedChangeAdjacencyList->Map.get(changeId)
    switch parent {
    | Some(parentChangeId) => {
        let newParentInDegrees = inDegrees->Map.get(parentChangeId)->Option.getExn - 1
        if newParentInDegrees > 0 {
          inDegrees->Map.set(parentChangeId, newParentInDegrees)
        } else {
          queue->Array.unshift(parentChangeId)
        }
      }
    | _ => ()
    }
  }

  Console.log(topSort)

  let output: array<AnalyzeCommandComponent.outputRow> = []
  let columns = []
  topSort->Array.forEach(changeId => {
    let prefColumnIdx = columns->Array.findIndex(v => v === changeId)
    if prefColumnIdx == -1 {
      columns->Array.push(changeId)
    }
    let changeColumnIdx = prefColumnIdx == -1 ? columns->Array.length - 1 : prefColumnIdx

    let nextRow = []
    for _ in 0 to changeColumnIdx - 1 {
      nextRow->Array.push(" │")
    }
    nextRow->Array.push(" ○")
    for _ in changeColumnIdx + 1 to columns->Array.length - 1 {
      nextRow->Array.push(" │")
    }
    output->Array.push({chars: nextRow, changeId})

    let parent = changeGraph.bookmarkedChangeAdjacencyList->Map.get(changeId)
    switch parent {
    | Some(parentChangeId) => {
        let parentColumnIdx = columns->Array.findIndex(id => id == parentChangeId)
        if parentColumnIdx != -1 && parentColumnIdx < changeColumnIdx {
          // Collapse the column to its left
          columns->Array.splice(~start=changeColumnIdx, ~remove=1, ~insert=[])

          let nextRow = []
          for _ in 0 to parentColumnIdx - 1 {
            nextRow->Array.push(" │")
          }
          nextRow->Array.push(" ├")
          for _ in parentColumnIdx + 1 to changeColumnIdx - 1 {
            nextRow->Array.push("─│")
          }
          nextRow->Array.push("─╯")
          for _ in changeColumnIdx + 1 to columns->Array.length - 1 {
            nextRow->Array.push(" │")
          }

          output->Array.push({chars: nextRow, changeId: ""})
        } else {
          columns[changeColumnIdx] = parentChangeId

          output->Array.push({
            chars: " │"->String.repeat(columns->Array.length)->String.split(""),
            changeId: "",
          })
        }
      }
    | None =>
      // This means its parent is actually trunk, which I want to always be in column 0
      if changeColumnIdx > 0 {
        let nextRow = []
        nextRow->Array.push(" ├")
        for _ in 1 to changeColumnIdx - 1 {
          nextRow->Array.push("─│")
        }
        for _ in changeColumnIdx to columns->Array.length - 1 {
          nextRow->Array.push("─╯")
        }

        columns->Array.splice(~start=changeColumnIdx, ~remove=1, ~insert=[])

        output->Array.push({chars: nextRow, changeId: ""})
      } else {
        output->Array.push({
          chars: " │"->String.repeat(columns->Array.length)->String.split(""),
          changeId: "",
        })
      }
    }
  })

  // output:
  //  ○ pxtukxlusrws (branchy)
  //  │
  //  │ ○ qxvtxrkwlntp (morework2)
  //  ├─╯
  //  ○ zysownlrrwor (morework1)
  //  │
  //  ○ zpkmkmkmxmws (morework0, morework00)
  //  │
  //  │ ○ uxwurwlzqkwy (branch3)
  //  │ │
  //  │ ○ pvsrsrmypmqk (branch2)
  //  │ │
  //  │ ○ kuzvuzknutyk (branch1)
  //  ├─╯
  //  │ ○ stkpqymzptot (branch0)
  //  ├─╯
  //  ○ trunk()

  render(<AnalyzeCommandComponent changeGraph prStatusMap output topSort />)

  Console.log("\n=== CHANGE GRAPH RESULTS ===")
  Console.log(`Total bookmarks: ${changeGraph.bookmarks->Map.size->Belt.Int.toString}`)
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

  Console.log("\n=== SEGMENT DETAILS ===")
  changeGraph.bookmarkedChangeIdToSegment->Map.forEachWithKey((segmentChanges, changeId) => {
    let logEntry = Option.getExn(segmentChanges[0])
    Console.log(`\n${changeId} (${logEntry.localBookmarks->Array.join(", ")}):`)
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
