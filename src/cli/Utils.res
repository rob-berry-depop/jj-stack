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

// AIDEV-NOTE: CLI utilities for user interaction, specifically bookmark conflict resolution

@scope("process") @val external stdin: 'a = "stdin"
@scope("process") @val external stdout: 'a = "stdout"

@module("readline") @val
external createInterface: {"input": 'a, "output": 'b} => 'interface = "createInterface"

@send external questionCallback: ('interface, string, string => unit) => unit = "question"
@send external close: 'interface => unit = "close"

/**
 * AIDEV-NOTE: Prompt user for input with a question
 * Fixed to properly handle readline's callback-based API
 */
let promptUser = async (questionText: string): string => {
  let rl = createInterface({"input": stdin, "output": stdout})

  let answer = await Js.Promise.make((~resolve, ~reject as _) => {
    rl->questionCallback(questionText, answer => {
      resolve(answer)
    })
  })

  rl->close
  answer->String.trim
}

/**
 * AIDEV-NOTE: Format segment with multiple bookmarks for display to user
 */
let formatSegmentWithMultipleBookmarks = (segment: JJTypes.bookmarkSegment): string => {
  let availableNames = segment.bookmarks->Array.map(b => b.name)->Array.join(", ")
  let bookmarksWithRemotes = segment.bookmarks->Array.filter(b => b.hasRemote)
  let withRemotes = bookmarksWithRemotes->Array.map(b => b.name)->Array.join(", ")

  let remotesInfo = if withRemotes == "" {
    "none have remote branches"
  } else {
    `bookmarks with remote branches: ${withRemotes}`
  }

  let firstBookmark = segment.bookmarks[0]->Option.getExn
  let changeId = firstBookmark.changeId
  `Change ${changeId}: multiple bookmarks [${availableNames}] (${remotesInfo})`
}

/**
 * AIDEV-NOTE: Helper function to prompt from all bookmarks with numbered choices
 */
let rec promptFromAllBookmarks = async (bookmarks: array<JJTypes.bookmark>): JJTypes.bookmark => {
  Console.log(`\nAvailable bookmarks:`)
  bookmarks->Array.forEachWithIndex((bookmark, i) => {
    let remoteStatus = if bookmark.hasRemote {
      if bookmark.isSynced {
        " (has remote, synced)"
      } else {
        " (has remote, not synced)"
      }
    } else {
      " (no remote)"
    }
    Console.log(`  ${(i + 1)->Int.toString}. ${bookmark.name}${remoteStatus}`)
  })

  let maxChoice = bookmarks->Array.length
  let rec promptChoice = async (): JJTypes.bookmark => {
    let answer = await promptUser(`\nSelect bookmark (1-${maxChoice->Int.toString}): `)

    switch answer->Int.fromString {
    | Some(choice) if choice >= 1 && choice <= maxChoice => bookmarks[choice - 1]->Option.getExn
    | _ => {
        Console.log(
          `Invalid choice. Please enter a number between 1 and ${maxChoice->Int.toString}.`,
        )
        await promptChoice()
      }
    }
  }

  await promptChoice()
}

/**
 * AIDEV-NOTE: Prompt user to select a bookmark from multiple options in a segment
 */
and promptBookmarkSelectionForSegment = async (
  segment: JJTypes.bookmarkSegment,
): JJTypes.bookmark => {
  Console.log(`\n⚠️  Multiple bookmarks found on the same change:`)
  Console.log(formatSegmentWithMultipleBookmarks(segment))

  // Compute bookmarks with remotes just-in-time
  let bookmarksWithRemotes = segment.bookmarks->Array.filter(b => b.hasRemote)

  // If only one bookmark has a remote, suggest that as default
  if bookmarksWithRemotes->Array.length == 1 {
    let defaultBookmark: JJTypes.bookmark = bookmarksWithRemotes[0]->Option.getExn
    let questionText = `\nOnly '${defaultBookmark.name}' has a remote branch. Use it? [Y/n]: `
    let answer = await promptUser(questionText)

    if answer == "" || answer->String.toLowerCase == "y" || answer->String.toLowerCase == "yes" {
      defaultBookmark
    } else {
      // User declined the suggestion, continue to full selection
      await promptFromAllBookmarks(segment.bookmarks)
    }
  } else {
    // Multiple or no remotes - show all options
    await promptFromAllBookmarks(segment.bookmarks)
  }
}

/**
 * AIDEV-NOTE: Resolve bookmark selections for all segments with multiple bookmarks
 */
let resolveBookmarkSelections = async (analysis: JJTypes.submissionAnalysis): array<
  JJTypes.bookmark,
> => {
  // Compute segments with multiple bookmarks locally (just for counting and messaging)
  let segmentsWithMultipleBookmarks =
    analysis.relevantSegments->Array.filter(segment => segment.bookmarks->Array.length > 1)

  if segmentsWithMultipleBookmarks->Array.length > 0 {
    Console.log(
      `\n🔀 Found ${segmentsWithMultipleBookmarks
        ->Array.length
        ->Int.toString} segment(s) with multiple bookmarks:`,
    )
  }

  let selectedBookmarks = []

  for i in 0 to analysis.relevantSegments->Array.length - 1 {
    let segment: JJTypes.bookmarkSegment = analysis.relevantSegments[i]->Option.getExn

    if segment.bookmarks->Array.length == 1 {
      // Single bookmark - use it
      selectedBookmarks->Array.push(segment.bookmarks[0]->Option.getExn)->ignore
    } else {
      // Multiple bookmarks - need user selection
      let selectedBookmark = await promptBookmarkSelectionForSegment(segment)
      selectedBookmarks->Array.push(selectedBookmark)->ignore
      Console.log(`✅ Selected '${selectedBookmark.name}' for change ${selectedBookmark.changeId}`)
    }
  }

  if segmentsWithMultipleBookmarks->Array.length > 0 {
    Console.log(`\n✨ All bookmark selections completed!`)
  }

  selectedBookmarks
}
