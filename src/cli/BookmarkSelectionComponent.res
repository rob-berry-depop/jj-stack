// AIDEV-NOTE: Interactive UI component for bookmark selection during submit command
// Allows user to navigate changes with multiple bookmarks and select which bookmark to use

@module("process") external exit: int => unit = "exit"

module Text = InkBindings.Text

// AIDEV-NOTE: Internal state for tracking user selections and navigation
type selectionState = {
  // Index into the selectableSegmentIndices array (derived via useMemo)
  focusedSelectableIndex: int,
  // Map from changeId to selected bookmark index within that segment
  selections: Map.t<string, int>,
}

/**
 * AIDEV-NOTE: Apply default selection logic - auto-select bookmarks with remotes
 * If exactly one bookmark has remote -> auto-select it
 * Otherwise -> no default selection
 */
let applyDefaultSelections = (segments: array<JJTypes.bookmarkSegment>): Map.t<string, int> => {
  let selections = Map.make()

  segments->Array.forEachWithIndex((segment, _segmentIndex) => {
    if segment.bookmarks->Array.length > 1 {
      let bookmarksWithRemotes = segment.bookmarks->Array.filter(b => b.hasRemote)

      if bookmarksWithRemotes->Array.length == 1 {
        // Find index of the bookmark with remote
        let defaultBookmark = bookmarksWithRemotes[0]->Option.getExn
        let bookmarkIndex =
          segment.bookmarks->Array.findIndexOpt(b => b.name == defaultBookmark.name)

        switch bookmarkIndex {
        | Some(index) => {
            let changeId = (segment.bookmarks[0]->Option.getExn).changeId
            selections->Map.set(changeId, index)
          }
        | None => () // Should not happen
        }
      }
      // If 0 or multiple bookmarks have remotes, no default selection
    }
  })

  selections
}

/**
 * AIDEV-NOTE: Get indices of segments that have multiple bookmarks (need user selection)
 */
let getSelectableSegmentIndices = (segments: array<JJTypes.bookmarkSegment>): array<int> => {
  let indices = []
  segments->Array.forEachWithIndex((segment, index) => {
    if segment.bookmarks->Array.length > 1 {
      indices->Array.push(index)->ignore
    }
  })
  indices
}

/**
 * AIDEV-NOTE: Check if all segments with multiple bookmarks have selections made
 */
let areAllSelectionsComplete = (
  segments: array<JJTypes.bookmarkSegment>,
  selections: Map.t<string, int>,
): bool => {
  segments->Array.every(segment => {
    if segment.bookmarks->Array.length == 1 {
      true // Single bookmark segments are always "complete"
    } else {
      let changeId = (segment.bookmarks[0]->Option.getExn).changeId
      selections->Map.has(changeId)
    }
  })
}

/**
 * AIDEV-NOTE: Convert UI selections back to array of selected bookmarks
 */
let getSelectedBookmarks = (
  segments: array<JJTypes.bookmarkSegment>,
  selections: Map.t<string, int>,
): array<JJTypes.bookmark> => {
  let selectedBookmarks = []

  segments->Array.forEach(segment => {
    if segment.bookmarks->Array.length == 1 {
      // Single bookmark - always selected
      selectedBookmarks->Array.push(segment.bookmarks[0]->Option.getExn)->ignore
    } else {
      // Multiple bookmarks - get user selection
      let changeId = (segment.bookmarks[0]->Option.getExn).changeId
      let selectedIndex = selections->Map.get(changeId)->Option.getOr(0)
      selectedBookmarks->Array.push(segment.bookmarks[selectedIndex]->Option.getExn)->ignore
    }
  })

  selectedBookmarks
}

@react.component
let make = (
  ~segments: array<JJTypes.bookmarkSegment>,
  ~onComplete: array<JJTypes.bookmark> => unit,
) => {
  // AIDEV-NOTE: Memoize derived data - segments that have multiple bookmarks
  let selectableSegmentIndices = React.useMemo1(() => {
    getSelectableSegmentIndices(segments)
  }, [segments])

  // AIDEV-NOTE: Initialize state with default selections only (no derived data)
  let (selectionState, setSelectionState) = React.useState(() => {
    let defaultSelections = applyDefaultSelections(segments)
    {
      focusedSelectableIndex: 0,
      selections: defaultSelections,
    }
  })

  let isComplete = areAllSelectionsComplete(segments, selectionState.selections)

  // AIDEV-NOTE: Handle keyboard navigation
  InkBindings.useInput((_, key) => {
    if key.return && isComplete {
      // User pressed Enter and all selections are complete
      let selectedBookmarks = getSelectedBookmarks(segments, selectionState.selections)
      onComplete(selectedBookmarks)
    } else if key.upArrow {
      // Move focus up (to previous selectable change)
      setSelectionState(state => {
        if state.focusedSelectableIndex > 0 {
          {...state, focusedSelectableIndex: state.focusedSelectableIndex - 1}
        } else {
          state
        }
      })
    } else if key.downArrow {
      // Move focus down (to next selectable change)
      setSelectionState(state => {
        if state.focusedSelectableIndex < selectableSegmentIndices->Array.length - 1 {
          {...state, focusedSelectableIndex: state.focusedSelectableIndex + 1}
        } else {
          state
        }
      })
    } else if key.leftArrow || key.rightArrow {
      // Cycle through bookmark options for focused change
      setSelectionState(state => {
        if selectableSegmentIndices->Array.length == 0 {
          state
        } else {
          let focusedSegmentIndex =
            selectableSegmentIndices[state.focusedSelectableIndex]->Option.getExn
          let focusedSegment = segments[focusedSegmentIndex]->Option.getExn
          let changeId = (focusedSegment.bookmarks[0]->Option.getExn).changeId
          let currentSelection = state.selections->Map.get(changeId)->Option.getOr(0)
          let bookmarkCount = focusedSegment.bookmarks->Array.length

          let newSelection = if key.rightArrow {
            mod(currentSelection + 1, bookmarkCount)
          } else {
            mod(currentSelection - 1 + bookmarkCount, bookmarkCount)
          }

          let newSelections = Map.fromArray(state.selections->Map.entries->Array.fromIterator)
          newSelections->Map.set(changeId, newSelection)

          {...state, selections: newSelections}
        }
      })
    }
    ()
  }, None)

  // AIDEV-NOTE: Render the stack display
  <React.Fragment>
    <Text> {React.string("Select bookmarks for submission:\n")} </Text>
    {React.array(
      segments->Array.mapWithIndex((segment, segmentIndex) => {
        let changeId = (segment.bookmarks[0]->Option.getExn).changeId
        let isSelectable = segment.bookmarks->Array.length > 1
        let isFocused = if isSelectable {
          let selectableIndex = selectableSegmentIndices->Array.findIndexOpt(i => i == segmentIndex)
          switch selectableIndex {
          | Some(idx) => idx == selectionState.focusedSelectableIndex
          | None => false
          }
        } else {
          false
        }

        let focusIndicator = if isFocused {
          "▶ "
        } else {
          "  "
        }

        let bookmarkDisplay = if segment.bookmarks->Array.length == 1 {
          // Single bookmark - show with checkmark
          let bookmark = segment.bookmarks[0]->Option.getExn
          `${bookmark.name} ✓`
        } else {
          // Multiple bookmarks - show with selection indicators
          let maybeSelectedIndex = selectionState.selections->Map.get(changeId)
          segment.bookmarks
          ->Array.mapWithIndex((bookmark, bookmarkIndex) => {
            switch maybeSelectedIndex {
            | Some(selectedIndex) if bookmarkIndex == selectedIndex => `(${bookmark.name})`
            | _ => bookmark.name
            }
          })
          ->Array.join(" ")
        }

        <Text key={segmentIndex->Int.toString}>
          {React.string(`${focusIndicator}Change ${changeId}: ${bookmarkDisplay}\n`)}
        </Text>
      }),
    )}
    <Text> {React.string("\n")} </Text>
    <Text> {React.string("Use ↑↓ to navigate changes, ←→ to select bookmark\n")} </Text>
    {if isComplete {
      let selectableCount = selectableSegmentIndices->Array.length
      <React.Fragment>
        <Text>
          {React.string(
            `Press Enter to continue (${selectableCount->Int.toString}/${selectableCount->Int.toString} selections made)\n`,
          )}
        </Text>
      </React.Fragment>
    } else {
      let completedCount =
        selectableSegmentIndices
        ->Array.filter(segmentIndex => {
          let segment = segments[segmentIndex]->Option.getExn
          let changeId = (segment.bookmarks[0]->Option.getExn).changeId
          selectionState.selections->Map.has(changeId)
        })
        ->Array.length
      let totalCount = selectableSegmentIndices->Array.length
      <Text>
        {React.string(
          `Make selections to continue (${completedCount->Int.toString}/${totalCount->Int.toString} selections made)\n`,
        )}
      </Text>
    }}
  </React.Fragment>
}
