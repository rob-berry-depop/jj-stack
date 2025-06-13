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
          `  Bookmarks: ${stack.bookmarks.map((b) => b.name).join(", ")}`,
        );
        console.log(`  Total changes: ${stack.changes.length}`);

        if (stack.bookmarks.length > 1) {
          console.log("  📚 This is a stacked set of bookmarks!");
        }
      }
    }

    console.log("\n=== INDIVIDUAL BOOKMARK DETAILS ===");
    for (const [bookmarkName, changes] of changeGraph.allChanges) {
      console.log(`\n${bookmarkName}:`);
      console.log(`  Changes: ${changes.length}`);
      if (changes.length > 0) {
        console.log(`  Latest: ${changes[0].description_first_line}`);
        console.log(
          `  Oldest: ${changes[changes.length - 1].description_first_line}`,
        );
      }
    }
  } catch (error) {
    console.error("Failed to build change graph:", error);
    process.exit(1);
  }
}

void main();
