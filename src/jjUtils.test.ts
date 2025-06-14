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

// New test for complex branching scenario
export async function testComplexBranchingScenario() {
  console.log("\n=== Testing complex branching scenario ===");

  // Setup: A complex tree structure
  // trunk -> bookmark1 -> bookmark2 -> bookmark3
  //                             \-> bookmark4 -> bookmark5
  //                                        \-> bookmark6
  //
  // This tests multiple children at a non-root level (bookmark2 has children bookmark3 and bookmark4)
  // and bookmark4 also has multiple children (bookmark5 and bookmark6)
  // Expected: 3 stacks (one for each leaf: bookmark3, bookmark5, bookmark6)

  const mockBookmarks: Bookmark[] = [
    { name: "bookmark1", commit_id: "commit_b", change_id: "change_b" },
    { name: "bookmark2", commit_id: "commit_c", change_id: "change_c" },
    { name: "bookmark3", commit_id: "commit_d", change_id: "change_d" },
    { name: "bookmark4", commit_id: "commit_e", change_id: "change_e" },
    { name: "bookmark5", commit_id: "commit_f", change_id: "change_f" },
    { name: "bookmark6", commit_id: "commit_g", change_id: "change_g" },
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
      local_bookmarks: ["bookmark1"],
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
      local_bookmarks: ["bookmark2"],
      remote_bookmarks: [],
      is_current_working_copy: false,
    },
    {
      commit_id: "commit_d",
      change_id: "change_d",
      author_name: "Test",
      author_email: "test@example.com",
      description_first_line: "Change D",
      parents: ["commit_c"],
      local_bookmarks: ["bookmark3"],
      remote_bookmarks: [],
      is_current_working_copy: false,
    },
    {
      commit_id: "commit_e",
      change_id: "change_e",
      author_name: "Test",
      author_email: "test@example.com",
      description_first_line: "Change E",
      parents: ["commit_c"],
      local_bookmarks: ["bookmark4"],
      remote_bookmarks: [],
      is_current_working_copy: false,
    },
    {
      commit_id: "commit_f",
      change_id: "change_f",
      author_name: "Test",
      author_email: "test@example.com",
      description_first_line: "Change F",
      parents: ["commit_e"],
      local_bookmarks: ["bookmark5"],
      remote_bookmarks: [],
      is_current_working_copy: false,
    },
    {
      commit_id: "commit_g",
      change_id: "change_g",
      author_name: "Test",
      author_email: "test@example.com",
      description_first_line: "Change G",
      parents: ["commit_e"],
      local_bookmarks: ["bookmark6"],
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
      if (to === "commit_b") {
        // bookmark1: [B]
        return Promise.resolve([mockLogEntries[1]]);
      } else if (to === "commit_c") {
        // bookmark2: [C, B]
        return Promise.resolve([mockLogEntries[2], mockLogEntries[1]]);
      } else if (to === "commit_d") {
        // bookmark3: [D, C, B]
        return Promise.resolve([
          mockLogEntries[3],
          mockLogEntries[2],
          mockLogEntries[1],
        ]);
      } else if (to === "commit_e") {
        // bookmark4: [E, C, B]
        return Promise.resolve([
          mockLogEntries[4],
          mockLogEntries[2],
          mockLogEntries[1],
        ]);
      } else if (to === "commit_f") {
        // bookmark5: [F, E, C, B]
        return Promise.resolve([
          mockLogEntries[5],
          mockLogEntries[4],
          mockLogEntries[2],
          mockLogEntries[1],
        ]);
      } else if (to === "commit_g") {
        // bookmark6: [G, E, C, B]
        return Promise.resolve([
          mockLogEntries[6],
          mockLogEntries[4],
          mockLogEntries[2],
          mockLogEntries[1],
        ]);
      }
      return Promise.resolve([]);
    },
  };

  const result = await buildChangeGraph(mockJj);

  // Expected: Three stacks (one for each leaf)
  // Stack 1: trunk -> bookmark1 -> bookmark2 -> bookmark3
  // Stack 2: trunk -> bookmark1 -> bookmark2 -> bookmark4 -> bookmark5
  // Stack 3: trunk -> bookmark1 -> bookmark2 -> bookmark4 -> bookmark6

  console.log(`Number of stacks: ${result.stacks.length}`);

  if (result.stacks.length !== 3) {
    throw new Error(`Expected 3 stacks, got ${result.stacks.length}`);
  }

  // Verify that all leaf bookmarks are represented as the tip of exactly one stack
  const stackTips = result.stacks.map(
    (stack) => stack.segments[stack.segments.length - 1].bookmark.name,
  );
  const expectedTips = ["bookmark3", "bookmark5", "bookmark6"];

  for (const expectedTip of expectedTips) {
    if (!stackTips.includes(expectedTip)) {
      throw new Error(
        `Expected leaf bookmark ${expectedTip} to be a stack tip, but stack tips are: ${stackTips.join(", ")}`,
      );
    }
  }

  // Verify that each stack has the correct structure
  for (const stack of result.stacks) {
    const stackTip = stack.segments[stack.segments.length - 1].bookmark.name;

    if (stackTip === "bookmark3") {
      // Should be: bookmark1 -> bookmark2 -> bookmark3
      if (stack.segments.length !== 3) {
        throw new Error(
          `Stack ending with bookmark3 should have 3 segments, got ${stack.segments.length}`,
        );
      }
      if (
        stack.segments[0].bookmark.name !== "bookmark1" ||
        stack.segments[1].bookmark.name !== "bookmark2" ||
        stack.segments[2].bookmark.name !== "bookmark3"
      ) {
        throw new Error(
          `Stack ending with bookmark3 has wrong structure: ${stack.segments.map((s) => s.bookmark.name).join(" -> ")}`,
        );
      }
    } else if (stackTip === "bookmark5") {
      // Should be: bookmark1 -> bookmark2 -> bookmark4 -> bookmark5
      if (stack.segments.length !== 4) {
        throw new Error(
          `Stack ending with bookmark5 should have 4 segments, got ${stack.segments.length}`,
        );
      }
      if (
        stack.segments[0].bookmark.name !== "bookmark1" ||
        stack.segments[1].bookmark.name !== "bookmark2" ||
        stack.segments[2].bookmark.name !== "bookmark4" ||
        stack.segments[3].bookmark.name !== "bookmark5"
      ) {
        throw new Error(
          `Stack ending with bookmark5 has wrong structure: ${stack.segments.map((s) => s.bookmark.name).join(" -> ")}`,
        );
      }
    } else if (stackTip === "bookmark6") {
      // Should be: bookmark1 -> bookmark2 -> bookmark4 -> bookmark6
      if (stack.segments.length !== 4) {
        throw new Error(
          `Stack ending with bookmark6 should have 4 segments, got ${stack.segments.length}`,
        );
      }
      if (
        stack.segments[0].bookmark.name !== "bookmark1" ||
        stack.segments[1].bookmark.name !== "bookmark2" ||
        stack.segments[2].bookmark.name !== "bookmark4" ||
        stack.segments[3].bookmark.name !== "bookmark6"
      ) {
        throw new Error(
          `Stack ending with bookmark6 has wrong structure: ${stack.segments.map((s) => s.bookmark.name).join(" -> ")}`,
        );
      }
    }
  }

  // Verify segmentChanges map contains the right individual changes for each bookmark
  const bookmark1Changes = result.segmentChanges.get("bookmark1");
  const bookmark2Changes = result.segmentChanges.get("bookmark2");
  const bookmark3Changes = result.segmentChanges.get("bookmark3");
  const bookmark4Changes = result.segmentChanges.get("bookmark4");
  const bookmark5Changes = result.segmentChanges.get("bookmark5");
  const bookmark6Changes = result.segmentChanges.get("bookmark6");

  if (
    !bookmark1Changes ||
    bookmark1Changes.length !== 1 ||
    bookmark1Changes[0].change_id !== "change_b"
  ) {
    throw new Error(
      `Expected bookmark1 segmentChanges to contain only change_b`,
    );
  }
  if (
    !bookmark2Changes ||
    bookmark2Changes.length !== 1 ||
    bookmark2Changes[0].change_id !== "change_c"
  ) {
    throw new Error(
      `Expected bookmark2 segmentChanges to contain only change_c`,
    );
  }
  if (
    !bookmark3Changes ||
    bookmark3Changes.length !== 1 ||
    bookmark3Changes[0].change_id !== "change_d"
  ) {
    throw new Error(
      `Expected bookmark3 segmentChanges to contain only change_d`,
    );
  }
  if (
    !bookmark4Changes ||
    bookmark4Changes.length !== 1 ||
    bookmark4Changes[0].change_id !== "change_e"
  ) {
    throw new Error(
      `Expected bookmark4 segmentChanges to contain only change_e`,
    );
  }
  if (
    !bookmark5Changes ||
    bookmark5Changes.length !== 1 ||
    bookmark5Changes[0].change_id !== "change_f"
  ) {
    throw new Error(
      `Expected bookmark5 segmentChanges to contain only change_f`,
    );
  }
  if (
    !bookmark6Changes ||
    bookmark6Changes.length !== 1 ||
    bookmark6Changes[0].change_id !== "change_g"
  ) {
    throw new Error(
      `Expected bookmark6 segmentChanges to contain only change_g`,
    );
  }

  console.log("✅ All complex branching assertions passed!");
  console.log("Complex branching test completed successfully");
}

// Run the test if this file is executed directly
if (require.main === module) {
  testBranchingScenario()
    .then(() => testComplexBranchingScenario())
    .catch(console.error);
}
