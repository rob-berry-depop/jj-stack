import { buildChangeGraph, type JjFunctions } from "./jjUtils.js";
import type { LogEntry, Bookmark } from "./jjTypes.js";

export async function testBranchingScenario() {
  console.log("\n=== Testing buildChangeGraph branching scenario ===");

  // Setup: A -> B (bookmark3) -> C (bookmark1)
  //                          \-> D (bookmark2)

  const mockBookmarks: Bookmark[] = [
    { name: "bookmark1", commitId: "commit_c", changeId: "change_c" },
    { name: "bookmark2", commitId: "commit_d", changeId: "change_d" },
    { name: "bookmark3", commitId: "commit_b", changeId: "change_b" },
  ];

  const mockLogEntries: LogEntry[] = [
    {
      commitId: "commit_a",
      changeId: "change_a",
      authorName: "Test",
      authorEmail: "test@example.com",
      descriptionFirstLine: "Change A (trunk)",
      parents: [],
      localBookmarks: [],
      remoteBookmarks: [],
      isCurrentWorkingCopy: false,
    },
    {
      commitId: "commit_b",
      changeId: "change_b",
      authorName: "Test",
      authorEmail: "test@example.com",
      descriptionFirstLine: "Change B",
      parents: ["commit_a"],
      localBookmarks: ["bookmark3"],
      remoteBookmarks: [],
      isCurrentWorkingCopy: false,
    },
    {
      commitId: "commit_c",
      changeId: "change_c",
      authorName: "Test",
      authorEmail: "test@example.com",
      descriptionFirstLine: "Change C",
      parents: ["commit_b"],
      localBookmarks: ["bookmark1"],
      remoteBookmarks: [],
      isCurrentWorkingCopy: false,
    },
    {
      commitId: "commit_d",
      changeId: "change_d",
      authorName: "Test",
      authorEmail: "test@example.com",
      descriptionFirstLine: "Change D",
      parents: ["commit_b"],
      localBookmarks: ["bookmark2"],
      remoteBookmarks: [],
      isCurrentWorkingCopy: false,
    },
  ];

  const mockJj: JjFunctions = {
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
    result.stacks[0].segments[0].changes[0].changeId !== "change_b"
  ) {
    throw new Error(`Expected stack 0 bookmark3 segment to contain change_b`);
  }
  if (
    result.stacks[1].segments[0].changes.length !== 1 ||
    result.stacks[1].segments[0].changes[0].changeId !== "change_b"
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
      stack1LastSegment.changes[0].changeId !== "change_c"
    ) {
      throw new Error(`Expected bookmark1 segment to contain change_c`);
    }
    if (
      stack2LastSegment.changes.length !== 1 ||
      stack2LastSegment.changes[0].changeId !== "change_d"
    ) {
      throw new Error(`Expected bookmark2 segment to contain change_d`);
    }
  } else {
    if (
      stack1LastSegment.changes.length !== 1 ||
      stack1LastSegment.changes[0].changeId !== "change_d"
    ) {
      throw new Error(`Expected bookmark2 segment to contain change_d`);
    }
    if (
      stack2LastSegment.changes.length !== 1 ||
      stack2LastSegment.changes[0].changeId !== "change_c"
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
    bookmark1Changes[0].changeId !== "change_c"
  ) {
    throw new Error(`Expected bookmark1 segmentChanges to contain change_c`);
  }
  if (
    !bookmark2Changes ||
    bookmark2Changes.length !== 1 ||
    bookmark2Changes[0].changeId !== "change_d"
  ) {
    throw new Error(`Expected bookmark2 segmentChanges to contain change_d`);
  }
  if (
    !bookmark3Changes ||
    bookmark3Changes.length !== 1 ||
    bookmark3Changes[0].changeId !== "change_b"
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
    { name: "bookmark1", commitId: "commit_b", changeId: "change_b" },
    { name: "bookmark2", commitId: "commit_c", changeId: "change_c" },
    { name: "bookmark3", commitId: "commit_d", changeId: "change_d" },
    { name: "bookmark4", commitId: "commit_e", changeId: "change_e" },
    { name: "bookmark5", commitId: "commit_f", changeId: "change_f" },
    { name: "bookmark6", commitId: "commit_g", changeId: "change_g" },
  ];

  const mockLogEntries: LogEntry[] = [
    {
      commitId: "commit_a",
      changeId: "change_a",
      authorName: "Test",
      authorEmail: "test@example.com",
      descriptionFirstLine: "Change A (trunk)",
      parents: [],
      localBookmarks: [],
      remoteBookmarks: [],
      isCurrentWorkingCopy: false,
    },
    {
      commitId: "commit_b",
      changeId: "change_b",
      authorName: "Test",
      authorEmail: "test@example.com",
      descriptionFirstLine: "Change B",
      parents: ["commit_a"],
      localBookmarks: ["bookmark1"],
      remoteBookmarks: [],
      isCurrentWorkingCopy: false,
    },
    {
      commitId: "commit_c",
      changeId: "change_c",
      authorName: "Test",
      authorEmail: "test@example.com",
      descriptionFirstLine: "Change C",
      parents: ["commit_b"],
      localBookmarks: ["bookmark2"],
      remoteBookmarks: [],
      isCurrentWorkingCopy: false,
    },
    {
      commitId: "commit_d",
      changeId: "change_d",
      authorName: "Test",
      authorEmail: "test@example.com",
      descriptionFirstLine: "Change D",
      parents: ["commit_c"],
      localBookmarks: ["bookmark3"],
      remoteBookmarks: [],
      isCurrentWorkingCopy: false,
    },
    {
      commitId: "commit_e",
      changeId: "change_e",
      authorName: "Test",
      authorEmail: "test@example.com",
      descriptionFirstLine: "Change E",
      parents: ["commit_c"],
      localBookmarks: ["bookmark4"],
      remoteBookmarks: [],
      isCurrentWorkingCopy: false,
    },
    {
      commitId: "commit_f",
      changeId: "change_f",
      authorName: "Test",
      authorEmail: "test@example.com",
      descriptionFirstLine: "Change F",
      parents: ["commit_e"],
      localBookmarks: ["bookmark5"],
      remoteBookmarks: [],
      isCurrentWorkingCopy: false,
    },
    {
      commitId: "commit_g",
      changeId: "change_g",
      authorName: "Test",
      authorEmail: "test@example.com",
      descriptionFirstLine: "Change G",
      parents: ["commit_e"],
      localBookmarks: ["bookmark6"],
      remoteBookmarks: [],
      isCurrentWorkingCopy: false,
    },
  ];

  const mockJj: JjFunctions = {
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
    bookmark1Changes[0].changeId !== "change_b"
  ) {
    throw new Error(
      `Expected bookmark1 segmentChanges to contain only change_b`,
    );
  }
  if (
    !bookmark2Changes ||
    bookmark2Changes.length !== 1 ||
    bookmark2Changes[0].changeId !== "change_c"
  ) {
    throw new Error(
      `Expected bookmark2 segmentChanges to contain only change_c`,
    );
  }
  if (
    !bookmark3Changes ||
    bookmark3Changes.length !== 1 ||
    bookmark3Changes[0].changeId !== "change_d"
  ) {
    throw new Error(
      `Expected bookmark3 segmentChanges to contain only change_d`,
    );
  }
  if (
    !bookmark4Changes ||
    bookmark4Changes.length !== 1 ||
    bookmark4Changes[0].changeId !== "change_e"
  ) {
    throw new Error(
      `Expected bookmark4 segmentChanges to contain only change_e`,
    );
  }
  if (
    !bookmark5Changes ||
    bookmark5Changes.length !== 1 ||
    bookmark5Changes[0].changeId !== "change_f"
  ) {
    throw new Error(
      `Expected bookmark5 segmentChanges to contain only change_f`,
    );
  }
  if (
    !bookmark6Changes ||
    bookmark6Changes.length !== 1 ||
    bookmark6Changes[0].changeId !== "change_g"
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
