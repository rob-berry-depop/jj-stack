module Text = InkBindings.Text

type outputRow = {
  chars: array<string>,
  changeId: option<string>,
}

@react.component
let make = (
  ~changeGraph: JJTypes.changeGraph,
  ~output: array<outputRow>,
  ~topSort: array<string>,
  ~onSelect: string => unit,
) => {
  let (selectedChangeId, setSelectedChangeId) = React.useState(() =>
    output[0]->Option.mapOr(None, outputRow => outputRow.changeId)
  )

  InkBindings.useInput((_, key) => {
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
      } else if key.return {
        onSelect(selectedChangeId)
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

  <React.Fragment>
    <Text> {React.string("Select a stack to submit:")} </Text>
    {React.array(
      output->Array.mapWithIndex((line, idx) => {
        <Text key={idx->Int.toString}>
          <Text> {React.string(`${line.chars->Array.join("")}`)} </Text>
          {switch line.changeId {
          | Some(changeId) => {
              let bookmarksStr =
                " (" ++
                Utils.changeIdToLogEntry(changeGraph, changeId).localBookmarks->Array.join(
                  ", ",
                ) ++ ")"
              <Text>
                <Text color=?{selectedChangeIdAncestors->Set.has(changeId) ? Some("red") : None}>
                  {React.string(` ${changeId}${bookmarksStr}`)}
                </Text>
                {line.changeId == selectedChangeId
                  ? React.string(" ← press enter to select this stack")
                  : React.null}
              </Text>
            }
          | None => React.null
          }}
        </Text>
      }),
    )}
    <Text> {React.string(" ○ trunk()\n")} </Text>
  </React.Fragment>
}
