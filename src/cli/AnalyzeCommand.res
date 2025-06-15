@module("../lib/jjUtils.js")
external buildChangeGraph: unit => promise<JJTypes.changeGraph> = "buildChangeGraph"

let analyzeCommand = async () => {
  Console.log("Building change graph from user bookmarks...")
  let changeGraph = await buildChangeGraph()

  Console.log("\n=== CHANGE GRAPH RESULTS ===")
  Console.log(`Total bookmarks: ${changeGraph.bookmarks->Array.length->Belt.Int.toString}`)
  Console.log(`Total stacks: ${changeGraph.stacks->Array.length->Belt.Int.toString}`)

  if changeGraph.stacks->Array.length > 0 {
    Console.log("\n=== BOOKMARK STACKS ===")
    changeGraph.stacks->Array.forEachWithIndex((stack, i) => {
      Console.log(`\nStack ${(i + 1)->Belt.Int.toString}:`)
      Console.log(`  Base commit: ${stack.baseCommit}`)
      Console.log(
        `  Bookmarks: ${stack.segments->Array.map(s => s.bookmark.name)->Array.join(", ")}`,
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

  Console.log("\n=== INDIVIDUAL BOOKMARK DETAILS ===")
  changeGraph.segmentChanges->Map.forEachWithKey((segmentChanges, bookmarkName) => {
    Console.log(`\n${bookmarkName}:`)
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
