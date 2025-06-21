// AIDEV-NOTE: Simple test to verify Phase 2 data preparation and edge case handling

// Test the new helper functions
let testHelpers = () => {
  Console.log("🧪 Testing Phase 2 helper functions...")

  // Test isInteractiveUINeeded
  let singleBookmarkSegment: JJTypes.bookmarkSegment = {
    bookmarks: [
      {
        name: "test-single",
        commitId: "abc123",
        changeId: "abc123",
        hasRemote: true,
        isSynced: true,
      },
    ],
    changes: [],
  }

  let multiBookmarkSegment: JJTypes.bookmarkSegment = {
    bookmarks: [
      {
        name: "test-multi-1",
        commitId: "def456",
        changeId: "def456",
        hasRemote: true,
        isSynced: true,
      },
      {
        name: "test-multi-2",
        commitId: "def456",
        changeId: "def456",
        hasRemote: false,
        isSynced: false,
      },
    ],
    changes: [],
  }

  // Test with only single bookmark segments
  let singleOnlySegments = [singleBookmarkSegment]
  let needsUI1 = Utils.isInteractiveUINeeded(singleOnlySegments)
  Console.log(
    `✅ Single bookmark only: needsUI = ${needsUI1 ? "true" : "false"} (expected: false)`,
  )

  // Test with mixed segments
  let mixedSegments = [singleBookmarkSegment, multiBookmarkSegment]
  let needsUI2 = Utils.isInteractiveUINeeded(mixedSegments)
  Console.log(`✅ Mixed segments: needsUI = ${needsUI2 ? "true" : "false"} (expected: true)`)

  // Test getDirectBookmarkSelections
  let directSelections = Utils.getDirectBookmarkSelections(singleOnlySegments)
  Console.log(
    `✅ Direct selections: got ${directSelections->Array.length->Int.toString} bookmark(s)`,
  )
  Console.log(`   First bookmark: ${(directSelections[0]->Option.getExn).name}`)

  Console.log("🎉 Phase 2 helper tests completed!")
}

// Run the test
testHelpers()
