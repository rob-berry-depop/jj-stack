@module("process") external exit: int => unit = "exit"
module Text = {
  @module("ink") @react.component
  external make: (~children: React.element) => React.element = "Text"
}

type inkKey = {
  upArrow: bool,
  downArrow: bool,
}

type inkUseInputOptions = {isActive: bool}

@module("ink")
external useInput: ((string, inkKey) => unit, option<inkUseInputOptions>) => unit = "useInput"

type outputRow = {
  chars: array<string>,
  changeId: string,
}

@react.component
let make = (
  ~changeGraph: JJTypes.changeGraph,
  ~prStatusMap: Map.t<string, SubmitCommand.pullRequest>,
  ~output: array<outputRow>,
  ~topSort: array<string>,
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

  useInput((_, key) => {
    switch selectedChangeId {
    | Some(selectedChangeId) =>
      if key.upArrow {
        let selectedChangeIdRowIdx =
          topSort->Array.findIndexOpt(changeId => changeId == selectedChangeId)->Option.getExn
        if selectedChangeIdRowIdx > 0 {
          setSelectedChangeId(_ => Some(topSort[selectedChangeIdRowIdx - 1]->Option.getExn))
        }
      } else if key.downArrow {
        let selectedChangeIdRowIdx =
          topSort->Array.findIndexOpt(changeId => changeId == selectedChangeId)->Option.getExn
        if selectedChangeIdRowIdx < topSort->Array.length - 1 {
          setSelectedChangeId(_ => Some(topSort[selectedChangeIdRowIdx + 1]->Option.getExn))
        }
      }
    | None => ()
    }
    ()
  }, None)

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
      `${line.chars->Array.join("")} ${line.changeId}${selectedChangeIdAncestors->Set.has(
          line.changeId,
        )
          ? "!"
          : ""}${bookmarksStr}`
    })
    ->Array.join("\n") ++ "\n ○ trunk()\n"

  <Text> {React.string(str)} </Text>
}
