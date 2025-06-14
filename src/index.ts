#!/usr/bin/env node

import { buildChangeGraph } from "./jjUtils";

async function main() {
  console.log("jj-spice is running!");
  console.log("Building change graph from user bookmarks...");

  try {
    const changeGraph = await buildChangeGraph();

    console.log("\n=== CHANGE GRAPH RESULTS ===");
    console.log(`Total bookmarks: ${changeGraph.bookmarks.length}`);
    console.log(`Total stacks: ${changeGraph.stacks.length}`);

    if (changeGraph.stacks.length > 0) {
      console.log("\n=== BOOKMARK STACKS ===");
      for (let i = 0; i < changeGraph.stacks.length; i++) {
        const stack = changeGraph.stacks[i];
        console.log(`\nStack ${i + 1}:`);
        console.log(`  Base commit: ${stack.baseCommit}`);
        console.log(
          `  Bookmarks: ${stack.segments.map((s) => s.bookmark.name).join(", ")}`,
        );

        // Calculate total changes across all segments
        const totalChanges = stack.segments.reduce(
          (sum, segment) => sum + segment.changes.length,
          0,
        );
        console.log(`  Total changes: ${totalChanges}`);

        if (stack.segments.length > 1) {
          console.log("  📚 This is a stacked set of bookmarks!");
        }
      }
    }

    console.log("\n=== INDIVIDUAL BOOKMARK DETAILS ===");
    for (const [bookmarkName, segmentChanges] of changeGraph.segmentChanges) {
      console.log(`\n${bookmarkName}:`);
      console.log(`  Segment changes: ${segmentChanges.length}`);
      if (segmentChanges.length > 0) {
        console.log(`  Latest: ${segmentChanges[0].description_first_line}`);
        console.log(
          `  Oldest: ${segmentChanges[segmentChanges.length - 1].description_first_line}`,
        );
      }
    }
  } catch (error) {
    console.error("Failed to build change graph:", error);
    process.exit(1);
  }
}

void main();
