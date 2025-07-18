// AIDEV-NOTE: Interactive UI component for bookmark stack visualization and selection
// This component displays a text-based graph of stacked bookmarks and allows
// users to navigate and select which stack to submit as PRs
module Text = InkBindings.Text
module Box = InkBindings.Box

type outputRow = {
  chars: array<string>,
  changeId: option<string>,
}

type uiState = {
  selectedIndex: int,
  scrollOffset: int,
}

@react.component
let make = (
  ~changeGraph: JJTypes.changeGraph,
  ~output: array<outputRow>,
  ~onSelect: string => unit,
) => {
  // Find all selectable indices (lines with changeId)
  let selectableIndices = React.useMemo1(() => {
    output
    ->Array.mapWithIndex((row, index) => row.changeId->Option.isSome ? Some(index) : None)
    ->Array.filterMap(x => x)
  }, [output])

  // Find initial selected change (first selectable index)
  let initialSelectedIndex = selectableIndices->Array.get(0)->Option.getOr(0)

  // Combined state for selection and scroll position
  let (uiState, setUiState) = React.useState(() => {
    selectedIndex: initialSelectedIndex,
    scrollOffset: 0,
  })

  // Get terminal dimensions and calculate viewport
  let stdout = InkBindings.Hooks.useStdout()
  let terminalHeight = switch stdout["rows"] {
  | Some(rows) => rows
  | None =>
    // Fallback to process.stdout.rows when Ink's useStdout fails
    let processRows = %raw(`process.stdout.rows`)
    switch processRows {
    | Some(rows) => rows
    | None => 20 // Final fallback
    }
  }

  // Reserve space for: instructions (1 line) + scroll indicator (1 line) + empty line buffer (1 line)
  let contentViewportHeight = terminalHeight - 3
  let totalItems = output->Array.length

  // Helper function to calculate new scroll position based on selection
  let calculateScrollOffset = (
    selectedIndex,
    currentScrollOffset,
    contentViewportHeight,
    totalItems,
    selectableIndices,
  ) => {
    if totalItems <= contentViewportHeight {
      // Everything fits, no scrolling needed
      0
    } else {
      // Check if this is the last selectable commit
      let isLastCommit =
        selectableIndices->Array.length > 0 &&
          selectedIndex == selectableIndices[selectableIndices->Array.length - 1]->Option.getOr(0)

      let requiredEndIndex = if isLastCommit {
        // When last commit is selected, we MUST show trunk too
        totalItems - 1 // trunk line index
      } else {
        selectedIndex // just the selected item
      }

      // Standard viewport logic, but considering the "required end"
      if selectedIndex < currentScrollOffset {
        // Scroll up to show selection at top
        selectedIndex
      } else if requiredEndIndex >= currentScrollOffset + contentViewportHeight {
        // Scroll down to show required content at bottom
        requiredEndIndex - contentViewportHeight + 1
      } else {
        // Everything required is already visible
        currentScrollOffset
      }
    }
  }

  InkBindings.Hooks.useInput((_, key) => {
    if key.upArrow {
      // Find current position in selectable indices and move up
      let currentPos =
        selectableIndices->Array.findIndexOpt(idx => idx == uiState.selectedIndex)->Option.getOr(0)
      if currentPos > 0 {
        let newSelectedIndex = selectableIndices[currentPos - 1]->Option.getExn
        let newScrollOffset = calculateScrollOffset(
          newSelectedIndex,
          uiState.scrollOffset,
          contentViewportHeight,
          totalItems,
          selectableIndices,
        )
        setUiState(_ => {selectedIndex: newSelectedIndex, scrollOffset: newScrollOffset})
      }
    } else if key.downArrow {
      // Find current position in selectable indices and move down
      let currentPos =
        selectableIndices->Array.findIndexOpt(idx => idx == uiState.selectedIndex)->Option.getOr(0)
      if currentPos < selectableIndices->Array.length - 1 {
        let newSelectedIndex = selectableIndices[currentPos + 1]->Option.getExn
        let newScrollOffset = calculateScrollOffset(
          newSelectedIndex,
          uiState.scrollOffset,
          contentViewportHeight,
          totalItems,
          selectableIndices,
        )
        setUiState(_ => {selectedIndex: newSelectedIndex, scrollOffset: newScrollOffset})
      }
    } else if key.return {
      // Selected index should always be a commit (since we only navigate between commits)
      switch output[uiState.selectedIndex] {
      | Some(row) =>
        switch row.changeId {
        | Some(changeId) => onSelect(changeId)
        | None => () // Shouldn't happen since we only navigate to commits
        }
      | None => ()
      }
    }
    ()
  }, None)

  let selectedChangeIdAncestors = React.useMemo1(() => {
    // Get the currently selected changeId (should always exist since we only navigate to commits)
    let selectedChangeId = output[uiState.selectedIndex]->Option.flatMap(row => row.changeId)

    let ancestors = Belt.Set.String.empty
    switch selectedChangeId {
    | Some(selectedChangeId) => {
        let updatedAncestors = ancestors->Belt.Set.String.add(selectedChangeId)
        let cur = ref(selectedChangeId)
        let finalAncestors = ref(updatedAncestors)
        while changeGraph.bookmarkedChangeAdjacencyList->Map.has(cur.contents) {
          let parentChangeId =
            changeGraph.bookmarkedChangeAdjacencyList->Map.get(cur.contents)->Option.getExn
          finalAncestors := finalAncestors.contents->Belt.Set.String.add(parentChangeId)
          cur.contents = parentChangeId
        }
        finalAncestors.contents
      }
    | None => ancestors
    }
  }, [uiState.selectedIndex])

  // Calculate which items are visible in the viewport
  let (visibleStartIndex, visibleEndIndex) = if totalItems <= contentViewportHeight {
    (0, totalItems - 1)
  } else {
    let endIndex = uiState.scrollOffset + contentViewportHeight - 1
    // Ensure we don't exceed the actual content bounds
    let clampedEndIndex = Js.Math.min_int(endIndex, totalItems - 1)
    (uiState.scrollOffset, clampedEndIndex)
  }

  <Box flexDirection="column">
    // Instructions
    <Text> {React.string("Select a stack to submit:")} </Text>
    // Content - render visible output lines
    {React.array(
      Array.make(~length=visibleEndIndex - visibleStartIndex + 1, 0)
      ->Array.mapWithIndex((_, i) => visibleStartIndex + i)
      ->Array.map(itemIndex => {
        let isSelected = itemIndex == uiState.selectedIndex

        switch output[itemIndex] {
        | Some(row) =>
          <Text key={itemIndex->Int.toString} wrap="truncate">
            <Text color={isSelected ? "red" : "white"}>
              {React.string(isSelected ? "▶ " : "  ")}
            </Text>
            <Text> {React.string(`${row.chars->Array.join("")}`)} </Text>
            {switch row.changeId {
            | Some(changeId) => {
                let bookmarksStr =
                  " (" ++
                  Utils.changeIdToLogEntry(changeGraph, changeId).localBookmarks->Array.join(
                    ", ",
                  ) ++ ")"
                <Text wrap="truncate">
                  <Text
                    color=?{selectedChangeIdAncestors->Belt.Set.String.has(changeId)
                      ? Some("red")
                      : None}>
                    {React.string(` ${changeId}${bookmarksStr}`)}
                  </Text>
                  {isSelected ? React.string(" ← press enter to select this stack") : React.null}
                </Text>
              }
            | None => React.null
            }}
          </Text>
        | None => React.null
        }
      }),
    )}
    // Scroll indicator and instructions
    {totalItems > contentViewportHeight
      ? <Text dimColor=true>
          {React.string(
            `(${(visibleStartIndex + 1)->Int.toString}-${(visibleEndIndex + 1)
                ->Int.toString} of ${totalItems->Int.toString} lines) Use ↑↓ to navigate commits`,
          )}
        </Text>
      : <Text dimColor=true>
          {React.string("Use ↑↓ to navigate between commits, Enter to select")}
        </Text>}
  </Box>
}
