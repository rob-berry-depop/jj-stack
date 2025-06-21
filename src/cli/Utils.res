let sleep = (ms: int): Js.Promise.t<unit> =>
  Js.Promise.make((~resolve, ~reject as _) => {
    let _ = Js.Global.setTimeout(() => {
      resolve()
    }, ms)
  })

let changeIdToLogEntry = (changeGraph: JJTypes.changeGraph, changeId) => {
  let segment = changeGraph.bookmarkedChangeIdToSegment->Map.get(changeId)->Option.getExn
  segment[0]->Option.getExn
}

// AIDEV-NOTE: CLI utilities for user interaction, specifically bookmark selection

// AIDEV-NOTE: Ink render function returns an instance with cleanup methods
type inkInstance = {unmount: unit => unit}
@module("ink") external render: React.element => inkInstance = "render"

/**
 * AIDEV-NOTE: Check if interactive UI is needed for bookmark selection
 * UI is needed if any segments have multiple bookmarks
 */
let isInteractiveUINeeded = (segments: array<JJTypes.bookmarkSegment>): bool => {
  segments->Array.some(segment => segment.bookmarks->Array.length > 1)
}

/**
 * AIDEV-NOTE: Get selected bookmarks for segments with single bookmarks only
 * Used when no UI is needed - just return the single bookmark from each segment
 */
let getDirectBookmarkSelections = (segments: array<JJTypes.bookmarkSegment>): array<
  JJTypes.bookmark,
> => {
  segments->Array.map(segment => {
    // Validate that all segments have exactly one bookmark when this is called
    if segment.bookmarks->Array.length != 1 {
      // This should never happen - indicates a bug in the calling logic
      Console.error(
        `❌ Internal error: Expected single bookmark but found ${segment.bookmarks
          ->Array.length
          ->Int.toString}`,
      )
      Exn.raiseError(
        "Invalid state: getDirectBookmarkSelections called with multi-bookmark segment",
      )
    }
    segment.bookmarks[0]->Option.getExn
  })
}

/**
 * AIDEV-NOTE: Implementation using Ink UI for bookmark selection
 * Handles both single-bookmark (automatic) and multi-bookmark (interactive) cases
 */
let resolveBookmarkSelectionsWithUI = async (analysis: JJTypes.submissionAnalysis): array<
  JJTypes.bookmark,
> => {
  let segments = analysis.relevantSegments

  // Validate input
  if segments->Array.length == 0 {
    Console.error(`❌ No segments provided for bookmark selection`)
    Exn.raiseError("No segments to process")
  } else if !isInteractiveUINeeded(segments) {
    // No UI needed - all segments have single bookmarks
    Console.log(`📋 All changes have single bookmarks, proceeding automatically...`)
    getDirectBookmarkSelections(segments)
  } else {
    // UI needed - render the interactive component
    Console.log(`🔀 Found changes with multiple bookmarks, opening interactive selector...`)

    await Promise.make((resolve, reject) => {
      let inkInstanceRef = ref(None)

      let component =
        <BookmarkSelectionComponent
          segments={segments->Array.copy->Js.Array2.reverseInPlace} // AIDEV-NOTE: Reverse to show descendants first, ancestors last
          onComplete={bookmarks => {
            // Clean up the component first
            switch inkInstanceRef.contents {
            | Some(instance) => instance.unmount()
            | None => ()
            }

            // Validate that we got the expected number of bookmarks back
            if bookmarks->Array.length != segments->Array.length {
              Console.error(
                `❌ Selection mismatch: expected ${segments
                  ->Array.length
                  ->Int.toString} bookmarks, got ${bookmarks->Array.length->Int.toString}`,
              )
              reject(Failure("Selection count mismatch"))
            } else {
              // AIDEV-NOTE: Reverse bookmarks back to original trunk-to-leaf order
              resolve(bookmarks->Array.copy->Js.Array2.reverseInPlace)
            }
          }}
        />

      let inkInstance = render(component)
      inkInstanceRef := Some(inkInstance)
    })
  }
}

/**
 * AIDEV-NOTE: Resolve bookmark selections using Ink UI for interactive selection
 * Main entry point for bookmark selection - handles both automatic and user-driven cases
 */
let resolveBookmarkSelections = async (analysis: JJTypes.submissionAnalysis): array<
  JJTypes.bookmark,
> => {
  await resolveBookmarkSelectionsWithUI(analysis)
}
