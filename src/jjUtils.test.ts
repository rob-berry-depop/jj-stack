import { buildChangeGraph, type JjFunctions } from "./jjUtils";
import type { LogEntry, Bookmark } from "./jjTypes";

export async function testBranchingScenario() {
  console.log("\n=== Testing buildChangeGraph branching scenario ===");

  // Setup: A -> B (bookmark3) -> C (bookmark1)
  //                          \-> D (bookmark2)

  const mockBookmarks: Bookmark[] = [
    { name: "bookmark1", commit_id: "commit_c", change_id: "change_c" },
    { name: "bookmark2", commit_id: "commit_d", change_id: "change_d" },
    { name: "bookmark3", commit_id: "commit_b", change_id: "change_b" },
  ];

  const mockLogEntries: LogEntry[] = [
    {
      commit_id: "commit_a",
      change_id: "change_a",
      author_name: "Test",
      author_email: "test@example.com",
      description_first_line: "Change A (trunk)",
      parents: [],
      local_bookmarks: [],
      remote_bookmarks: [],
      is_current_working_copy: false,
    },
    {
      commit_id: "commit_b",
      change_id: "change_b",
      author_name: "Test",
      author_email: "test@example.com",
      description_first_line: "Change B",
      parents: ["commit_a"],
      local_bookmarks: ["bookmark3"],
      remote_bookmarks: [],
      is_current_working_copy: false,
    },
    {
      commit_id: "commit_c",
      change_id: "change_c",
      author_name: "Test",
      author_email: "test@example.com",
      description_first_line: "Change C",
      parents: ["commit_b"],
      local_bookmarks: ["bookmark1"],
      remote_bookmarks: [],
      is_current_working_copy: false,
    },
    {
      commit_id: "commit_d",
      change_id: "change_d",
      author_name: "Test",
      author_email: "test@example.com",
      description_first_line: "Change D",
      parents: ["commit_b"],
      local_bookmarks: ["bookmark2"],
      remote_bookmarks: [],
      is_current_working_copy: false,
    },
  ];

  const mockJj: JjFunctions = {
    getLogOutput: () => Promise.resolve(mockLogEntries),

    getMyBookmarks: () => Promise.resolve(mockBookmarks),

    findCommonAncestor: () => {
      // All bookmarks have common ancestor at commit_a (trunk)
      return Promise.resolve(mockLogEntries[0]); // commit_a
    },

    getChangesBetween: (_from: string, to: string) => {
      // Return changes between trunk (commit_a) and target commit
      if (to === "commit_c") {
        // bookmark1: changes from trunk to C = [C, B] (newest first)
        return Promise.resolve([mockLogEntries[2], mockLogEntries[1]]);
      } else if (to === "commit_d") {
        // bookmark2: changes from trunk to D = [D, B] (newest first)
        return Promise.resolve([mockLogEntries[3], mockLogEntries[1]]);
      } else if (to === "commit_b") {
        // bookmark3: changes from trunk to B = [B]
        return Promise.resolve([mockLogEntries[1]]);
      }
      return Promise.resolve([]);
    },
  };

  const result = await buildChangeGraph(mockJj);

  // Expected: Two stacks
  // Stack 1: trunk -> bookmark3 -> bookmark1
  // Stack 2: trunk -> bookmark3 -> bookmark2

  console.log(`Number of stacks: ${result.stacks.length}`);

  if (result.stacks.length !== 2) {
    throw new Error(`Expected 2 stacks, got ${result.stacks.length}`);
  }

  // Each stack should have 2 segments
  if (result.stacks[0].segments.length !== 2) {
    throw new Error(
      `Expected stack 0 to have 2 segments, got ${result.stacks[0].segments.length}`,
    );
  }
  if (result.stacks[1].segments.length !== 2) {
    throw new Error(
      `Expected stack 1 to have 2 segments, got ${result.stacks[1].segments.length}`,
    );
  }

  // Both stacks should start with bookmark3 as the first segment
  if (result.stacks[0].segments[0].bookmark.name !== "bookmark3") {
    throw new Error(
      `Expected stack 0 first segment to be bookmark3, got ${result.stacks[0].segments[0].bookmark.name}`,
    );
  }
  if (result.stacks[1].segments[0].bookmark.name !== "bookmark3") {
    throw new Error(
      `Expected stack 1 first segment to be bookmark3, got ${result.stacks[1].segments[0].bookmark.name}`,
    );
  }

  // The bookmark3 segments should contain change B
  if (
    result.stacks[0].segments[0].changes.length !== 1 ||
    result.stacks[0].segments[0].changes[0].change_id !== "change_b"
  ) {
    throw new Error(`Expected stack 0 bookmark3 segment to contain change_b`);
  }
  if (
    result.stacks[1].segments[0].changes.length !== 1 ||
    result.stacks[1].segments[0].changes[0].change_id !== "change_b"
  ) {
    throw new Error(`Expected stack 1 bookmark3 segment to contain change_b`);
  }

  // One stack should end with bookmark1, the other with bookmark2
  const stack1LastSegment = result.stacks[0].segments[1];
  const stack2LastSegment = result.stacks[1].segments[1];

  const endBookmarks = [
    stack1LastSegment.bookmark.name,
    stack2LastSegment.bookmark.name,
  ];
  if (
    !endBookmarks.includes("bookmark1") ||
    !endBookmarks.includes("bookmark2")
  ) {
    throw new Error(
      `Expected stacks to end with bookmark1 and bookmark2, got ${endBookmarks.join(", ")}`,
    );
  }

  // The tip segments should contain the correct changes
  if (stack1LastSegment.bookmark.name === "bookmark1") {
    if (
      stack1LastSegment.changes.length !== 1 ||
      stack1LastSegment.changes[0].change_id !== "change_c"
    ) {
      throw new Error(`Expected bookmark1 segment to contain change_c`);
    }
    if (
      stack2LastSegment.changes.length !== 1 ||
      stack2LastSegment.changes[0].change_id !== "change_d"
    ) {
      throw new Error(`Expected bookmark2 segment to contain change_d`);
    }
  } else {
    if (
      stack1LastSegment.changes.length !== 1 ||
      stack1LastSegment.changes[0].change_id !== "change_d"
    ) {
      throw new Error(`Expected bookmark2 segment to contain change_d`);
    }
    if (
      stack2LastSegment.changes.length !== 1 ||
      stack2LastSegment.changes[0].change_id !== "change_c"
    ) {
      throw new Error(`Expected bookmark1 segment to contain change_c`);
    }
  }

  // Verify segmentChanges map
  const bookmark1Changes = result.segmentChanges.get("bookmark1");
  const bookmark2Changes = result.segmentChanges.get("bookmark2");
  const bookmark3Changes = result.segmentChanges.get("bookmark3");

  if (
    !bookmark1Changes ||
    bookmark1Changes.length !== 1 ||
    bookmark1Changes[0].change_id !== "change_c"
  ) {
    throw new Error(`Expected bookmark1 segmentChanges to contain change_c`);
  }
  if (
    !bookmark2Changes ||
    bookmark2Changes.length !== 1 ||
    bookmark2Changes[0].change_id !== "change_d"
  ) {
    throw new Error(`Expected bookmark2 segmentChanges to contain change_d`);
  }
  if (
    !bookmark3Changes ||
    bookmark3Changes.length !== 1 ||
    bookmark3Changes[0].change_id !== "change_b"
  ) {
    throw new Error(`Expected bookmark3 segmentChanges to contain change_b`);
  }

  console.log("✅ All assertions passed!");
  console.log("Test completed successfully");
}

// Run the test if this file is executed directly
if (require.main === module) {
  testBranchingScenario().catch(console.error);
}
