// AIDEV-NOTE: External bindings for Node.js modules needed for JJ executable detection
@module("which")
external which: (string, {"nothrow": bool}) => Js.Promise.t<Js.Nullable.t<string>> = "default"
@module("os") external homedir: unit => string = "homedir"
@module("path") external pathJoinMany: array<string> => string = "join"
@val external process: {"env": Js.Dict.t<string>} = "process"

// AIDEV-NOTE: Type definition for JJ executable path resolution result
type jjPathResult = {
  filepath: string,
  source: [#configured | #path | #common],
}

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

    Console.log() // add space between the above logs and the component
    await Promise.make((resolve, reject) => {
      let inkInstanceRef: ref<option<InkBindings.inkInstance>> = ref(None)

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

      let inkInstance = InkBindings.render(component)
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

/**
 * AIDEV-NOTE: Gets the configured jj executable path from environment or searches common paths
 * Searches environment, PATH, then common locations
 */
let getJJPath = (): Js.Promise.t<jjPathResult> => {
  // Check if JJ_PATH environment variable is set (similar to configured path)
  let envPath = Js.Dict.get(process["env"], "JJ_PATH")

  // Helper function to check common paths
  let rec checkCommonPaths = (pathIndex: int, commonPaths: array<string>): Js.Promise.t<
    option<string>,
  > => {
    if pathIndex >= Array.length(commonPaths) {
      Js.Promise.resolve(None)
    } else {
      let currentPath = commonPaths[pathIndex]->Option.getExn

      Js.Promise.then_(whichResult => {
        switch Js.Nullable.toOption(whichResult) {
        | Some(foundPath) => Js.Promise.resolve(Some(foundPath))
        | None => checkCommonPaths(pathIndex + 1, commonPaths)
        }
      }, which(currentPath, {"nothrow": true}))
    }
  }

  switch envPath {
  | Some(configuredPath) => Js.Promise.then_(whichResult => {
      switch Js.Nullable.toOption(whichResult) {
      | Some(_) => Js.Promise.resolve({filepath: configuredPath, source: #configured})
      | None =>
        Js.Promise.reject(
          Js.Exn.raiseError(`Configured JJ_PATH is not an executable file: ${configuredPath}`),
        )
      }
    }, which(configuredPath, {"nothrow": true}))
  | None =>
    // Check if 'jj' is in PATH

    Js.Promise.then_(jjInPath => {
      switch Js.Nullable.toOption(jjInPath) {
      | Some(foundPath) => Js.Promise.resolve({filepath: foundPath, source: #path})
      | None => {
          // Check common installation paths
          let homeDir = homedir()
          let commonPaths = [
            pathJoinMany([homeDir, ".cargo", "bin", "jj"]),
            pathJoinMany([homeDir, ".cargo", "bin", "jj.exe"]),
            pathJoinMany([homeDir, ".nix-profile", "bin", "jj"]),
            pathJoinMany([homeDir, ".local", "bin", "jj"]),
            pathJoinMany([homeDir, "bin", "jj"]),
            "/usr/bin/jj",
            "/home/linuxbrew/.linuxbrew/bin/jj",
            "/usr/local/bin/jj",
            "/opt/homebrew/bin/jj",
            "/opt/local/bin/jj",
          ]

          Js.Promise.then_(foundCommonPath => {
            switch foundCommonPath {
            | Some(foundPath) => Js.Promise.resolve({filepath: foundPath, source: #common})
            | None =>
              Js.Promise.reject(
                Js.Exn.raiseError("jj CLI not found in PATH nor in common locations."),
              )
            }
          }, checkCommonPaths(0, commonPaths))
        }
      }
    }, which("jj", {"nothrow": true}))
  }
}
