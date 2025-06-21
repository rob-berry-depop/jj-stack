type octoKit = {}

type gitHubConfig = {
  owner: string,
  repo: string,
  octokit: octoKit,
}

@module("../lib/jjUtils.js")
external createJjFunctions: JJTypes.jjConfig => JJTypes.jjFunctions = "createJjFunctions"
@module("../lib/jjUtils.js")
external buildChangeGraph: JJTypes.jjFunctions => promise<JJTypes.changeGraph> = "buildChangeGraph"
@module("../lib/submit.js")
external getExistingPRs: (
  octoKit,
  string,
  string,
  array<string>,
) => promise<Map.t<string, SubmitCommand.pullRequest>> = "getExistingPRs"
@module("../lib/submit.js")
external getGitHubConfig: unit => promise<gitHubConfig> = "getGitHubConfig"

let analyzeCommand = async () => {
  // AIDEV-NOTE: Hardcoded JJ binary path - moved from library to CLI
  let jjConfig: JJTypes.jjConfig = {
    binaryPath: "/Users/keane/code/jj-v0.30.0-aarch64-apple-darwin",
  }

  Console.log("Fetching from remote...")

  let jjFunctions = createJjFunctions(jjConfig)

  try {
    await jjFunctions.gitFetch()
  } catch {
  | Exn.Error(error) =>
    Console.error(
      "Error fetching from remote: " ++ error->Exn.message->Option.getOr("Unknown error"),
    )
  }

  Console.log("Building change graph from user bookmarks...")
  let changeGraph = await buildChangeGraph(jjFunctions)

  if changeGraph.stacks->Array.length == 0 {
    Console.log(
      "No bookmark stacks found. Create bookmarks with `jj bookmark create [revision]` first.",
    )
    exit(0)
  }

  let inDegrees = Map.make()
  changeGraph.bookmarkedChangeAdjacencyList->Map.forEach(parentChangeId => {
    inDegrees->Map.set(parentChangeId, inDegrees->Map.get(parentChangeId)->Option.getOr(0) + 1)
  })

  let queue =
    changeGraph.stackLeafs
    ->Set.toArray
    ->Js.Array2.sortInPlaceWith((a, b) => {
      let logEntryA = Utils.changeIdToLogEntry(changeGraph, a)
      let logEntryB = Utils.changeIdToLogEntry(changeGraph, b)
      logEntryB.committedAt->Date.getTime->Float.toInt -
        logEntryA.committedAt->Date.getTime->Float.toInt
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
    output->Array.push({chars: nextRow, changeId: Some(changeId)})

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

          output->Array.push({chars: nextRow, changeId: None})
        } else {
          columns[changeColumnIdx] = parentChangeId

          output->Array.push({
            chars: " │"->String.repeat(columns->Array.length)->String.split(""),
            changeId: None,
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

        output->Array.push({chars: nextRow, changeId: None})
      } else {
        output->Array.push({
          chars: " │"->String.repeat(columns->Array.length)->String.split(""),
          changeId: None,
        })
      }
    }
  })

  Console.log() // add space between the above logs and the component
  let changeId = await Promise.make((resolve, _reject) => {
    let inkInstanceRef: ref<option<InkBindings.inkInstance>> = ref(None)

    let inkInstance = InkBindings.render(
      <AnalyzeCommandComponent
        changeGraph
        output
        topSort
        onSelect={changeId => {
          // Clean up the component first
          switch inkInstanceRef.contents {
          | Some(instance) => instance.unmount()
          | None => ()
          }

          resolve(changeId)
        }}
      />,
    )
    inkInstanceRef := Some(inkInstance)
  })

  let segment = changeGraph.bookmarkedChangeIdToSegment->Map.get(changeId)->Option.getExn
  let logEntry = segment[0]->Option.getExn
  await SubmitCommand.runSubmit(
    jjConfig,
    logEntry.localBookmarks[0]->Option.getExn,
    changeGraph,
    false,
  )
}
