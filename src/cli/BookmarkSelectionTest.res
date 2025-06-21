// AIDEV-NOTE: Test harness for BookmarkSelectionComponent with sample data
// This demonstrates the component working with mock data for development

@module("ink") external render: React.element => unit = "render"

// AIDEV-NOTE: Mock data to test the component behavior
let createMockSegments = (): array<JJTypes.bookmarkSegment> => {
  // Single bookmark segment (should show with checkmark)
  let singleBookmarkSegment: JJTypes.bookmarkSegment = {
    bookmarks: [
      {
        name: "feature-main",
        commitId: "abc123commit",
        changeId: "abc123",
        hasRemote: true,
        isSynced: true,
      },
    ],
    changes: [], // Not used in UI
  }

  // Multiple bookmarks with one having remote (should default to remote one)
  let multipleBookmarksWithRemoteSegment: JJTypes.bookmarkSegment = {
    bookmarks: [
      {
        name: "refactor-part1",
        commitId: "def456commit",
        changeId: "def456",
        hasRemote: true,
        isSynced: false,
      },
      {
        name: "refactor-alternate",
        commitId: "def456commit",
        changeId: "def456",
        hasRemote: false,
        isSynced: false,
      },
    ],
    changes: [],
  }

  // Multiple bookmarks with no defaults (user must choose)
  let multipleBookmarksNoDefaultSegment: JJTypes.bookmarkSegment = {
    bookmarks: [
      {
        name: "hotfix-a",
        commitId: "ghi789commit",
        changeId: "ghi789",
        hasRemote: false,
        isSynced: false,
      },
      {
        name: "hotfix-b",
        commitId: "ghi789commit",
        changeId: "ghi789",
        hasRemote: false,
        isSynced: false,
      },
      {
        name: "hotfix-c",
        commitId: "ghi789commit",
        changeId: "ghi789",
        hasRemote: false,
        isSynced: false,
      },
    ],
    changes: [],
  }

  [singleBookmarkSegment, multipleBookmarksWithRemoteSegment, multipleBookmarksNoDefaultSegment]
}

let testBookmarkSelection = () => {
  Console.log("🧪 Testing BookmarkSelectionComponent...")
  let mockSegments = createMockSegments()

  let onComplete = (selectedBookmarks: array<JJTypes.bookmark>) => {
    Console.log("✅ User completed bookmark selection:")
    selectedBookmarks->Array.forEach(bookmark => {
      Console.log(`   Selected: ${bookmark.name} (change: ${bookmark.changeId})`)
    })
    Console.log("Exiting test...")
    exit(0)
  }

  let component = <BookmarkSelectionComponent segments=mockSegments onComplete />
  render(component)
}

// Run the test when this file is executed
testBookmarkSelection()
