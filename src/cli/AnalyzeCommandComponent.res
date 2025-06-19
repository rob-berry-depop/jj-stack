@module("process") external exit: int => unit = "exit"
module Text = {
  @module("ink") @react.component
  external make: (~children: React.element) => React.element = "Text"
}

type outputRow = {
  chars: array<string>,
  changeId: string,
}

@react.component
let make = (
  ~changeGraph: JJTypes.changeGraph,
  ~prStatusMap: Map.t<string, SubmitCommand.pullRequest>,
  ~output: array<outputRow>,
) => {
  let isDataActionable =
    changeGraph.bookmarks
    ->Map.values
    ->Array.fromIterator
    ->Array.some(bookmark =>
      !bookmark.hasRemote || !bookmark.isSynced || prStatusMap->Map.get(bookmark.name) == None
    )

  React.useEffect(() => {
    if !isDataActionable {
      exit(0)
    }
    None
  }, [])

  let (selectedChangeId, setSelectedChangeId) = React.useState(() =>
    output[0]->Option.mapOr(None, outputRow => Some(outputRow.changeId))
  )

  let selectedChangeIdAncestors = Set.make()
  switch selectedChangeId {
  | Some(selectedChangeId) => {
      selectedChangeIdAncestors->Set.add(selectedChangeId)
      let cur = ref(selectedChangeId)
      while changeGraph.bookmarkedChangeAdjacencyList->Map.has(cur.contents) {
        let parentChangeId =
          changeGraph.bookmarkedChangeAdjacencyList->Map.get(cur.contents)->Option.getExn
        selectedChangeIdAncestors->Set.add(parentChangeId)
        cur.contents = parentChangeId
      }
      ()
    }
  | None => ()
  }

  let str =
    output
    ->Array.map(line => {
      let bookmarksStr =
        line.changeId != ""
          ? " (" ++
            Utils.changeIdToLogEntry(changeGraph, line.changeId).localBookmarks->Array.join(
              ", ",
            ) ++ ")"
          : ""
      `${line.chars->Array.join("")} ${line.changeId}${bookmarksStr}`
    })
    ->Array.join("\n") ++ "\n ○ trunk()\n"

  <Text> {React.string(str)} </Text>
}
