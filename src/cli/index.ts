#!/usr/bin/env node

import { buildChangeGraph } from "../lib/jjUtils.js";
import { main } from "./CLI.gen.js";

function showHelp() {
  console.log("🔧 jj-stack - Jujutsu Git workflow automation");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("");
  console.log("USAGE:");
  console.log("  jj-stack [COMMAND] [OPTIONS]");
  console.log("");
  console.log("COMMANDS:");
  console.log(
    "  submit <bookmark>     Submit a bookmark (and its stack) as PRs",
  );
  console.log(
    "    --dry-run           Show what would be done without making changes",
  );
  console.log("");
  console.log("  auth test             Test GitHub authentication");
  console.log("  auth logout           Clear saved authentication");
  console.log("  auth help             Show authentication help");
  console.log("");
  console.log("  help, --help, -h      Show this help message");
  console.log("");
  console.log("DEFAULT BEHAVIOR:");
  console.log(
    "  Running jj-stack without arguments shows the current change graph",
  );
  console.log("");
  console.log("EXAMPLES:");
  console.log("  jj-stack                        # Show change graph");
  console.log(
    "  jj-stack submit feature-branch  # Submit feature-branch as PR",
  );
  console.log(
    "  jj-stack submit feature-branch --dry-run  # Preview what would be done",
  );
  console.log("  jj-stack auth test              # Test GitHub authentication");
  console.log("");
  console.log(
    "For more information, visit: https://github.com/your-org/jj-stack",
  );
}

async function oldMain() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "help" || command === "--help" || command === "-h") {
    showHelp();
    return;
  }

  // Default behavior - show change graph
  console.log("jj-stack is running!");
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

void oldMain();
void main();
