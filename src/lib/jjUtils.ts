import { execFile } from "child_process"; // Changed from 'exec' to 'execFile'
import type {
  LogEntry,
  Bookmark,
  BranchStack,
  ChangeGraph,
  BookmarkSegment,
} from "./jjTypes.js";

const JJ_BINARY = "/Users/keane/code/jj-v0.30.0-aarch64-apple-darwin";

// Types for dependency injection
export type JjFunctions = {
  getMyBookmarks: () => Promise<Bookmark[]>;
  findCommonAncestor: (bookmarkName: string) => Promise<LogEntry>;
  getChangesBetween: (
    from: string,
    to: string,
    lastSeenCommit?: string,
  ) => Promise<LogEntry[]>;
};

/**
 * Get all bookmarks created by the current user
 */
export function getMyBookmarks(): Promise<Bookmark[]> {
  return new Promise((resolve, reject) => {
    const bookmarkTemplate = `'{ "name":' ++ name.escape_json() ++ ', ' ++ '"commitId":' ++ normal_target.commit_id().short().escape_json() ++ ', ' ++ '"changeId":' ++ normal_target.change_id().short().escape_json() ++ ' }\n'`;

    execFile(
      JJ_BINARY,
      [
        "bookmark",
        "list",
        "--revisions",
        "mine()",
        "--template",
        bookmarkTemplate,
      ],
      (error, stdout, stderr) => {
        if (error) {
          console.error(
            `Failed to get bookmarks: ${(error as Error).toString()}`,
          );
          return reject(error as Error);
        }
        if (stderr) {
          console.error(`stderr: ${stderr}`);
        }

        const bookmarks: Bookmark[] = [];
        const lines = stdout.trim().split("\n");

        for (const line of lines) {
          if (line.trim() === "") continue;

          try {
            const bookmark = JSON.parse(line) as Bookmark;
            bookmarks.push(bookmark);
          } catch (parseError) {
            console.error(`Failed to parse bookmark line: ${line}`, parseError);
          }
        }

        resolve(bookmarks);
      },
    );
  });
}

/**
 * Find the common ancestor between a bookmark and trunk
 */
export function findCommonAncestor(bookmarkName: string): Promise<LogEntry> {
  return new Promise((resolve, reject) => {
    const jjTemplate = `'{ "commitId":' ++ commit_id.short().escape_json() ++ ', ' ++ '"changeId":' 
++ change_id.short().escape_json() ++ ', ' ++ '"authorName":' ++ author.name().escape_json() ++ 
', ' ++ '"authorEmail":' ++ stringify(author.email().local() ++ '@' ++
author.email().domain()).escape_json() ++ ', ' ++ '"descriptionFirstLine":' ++ 
description.first_line().trim().escape_json() ++ ', ' ++ '"parents": [' ++ parents.map(|p| 
p.commit_id().short().escape_json()).join(",") ++ '], ' ++ '"localBookmarks": [' ++ 
local_bookmarks.map(|b| b.name().escape_json()).join(",") ++ '], ' ++ '"remoteBookmarks": [' ++
remote_bookmarks.map(|b| stringify(b.name() ++ '@' ++ b.remote()).escape_json()).join(",") ++ 
'], ' ++ '"isCurrentWorkingCopy":' ++ current_working_copy ++ ' }\n'`;

    execFile(
      JJ_BINARY,
      [
        "log",
        "--revisions",
        `ancestors(${bookmarkName}) & ancestors(trunk())`,
        "--no-graph",
        "-n",
        "1",
        "--template",
        jjTemplate,
      ],
      (error, stdout, stderr) => {
        if (error) {
          console.error(
            `Failed to find common ancestor for ${bookmarkName}: ${(error as Error).toString()}`,
          );
          return reject(
            new Error(
              `No common ancestor found between ${bookmarkName} and trunk()`,
            ),
          );
        }
        if (stderr) {
          console.error(`stderr: ${stderr}`);
        }

        const lines = stdout.trim().split("\n");
        if (lines.length === 0 || lines[0] === "") {
          return reject(
            new Error(
              `No common ancestor found between ${bookmarkName} and trunk()`,
            ),
          );
        }

        try {
          const ancestor = JSON.parse(lines[0]) as LogEntry;
          resolve(ancestor);
        } catch (parseError) {
          reject(
            new Error(`Failed to parse common ancestor: ${String(parseError)}`),
          );
        }
      },
    );
  });
}

/**
 * Get changes between two commits with pagination
 */
export function getChangesBetween(
  from: string,
  to: string,
  lastSeenCommit?: string,
): Promise<LogEntry[]> {
  return new Promise((resolve, reject) => {
    const jjTemplate = `'{ "commitId":' ++ commit_id.short().escape_json() ++ ', ' ++ '"changeId":' 
++ change_id.short().escape_json() ++ ', ' ++ '"authorName":' ++ author.name().escape_json() ++ 
', ' ++ '"authorEmail":' ++ stringify(author.email().local() ++ '@' ++
author.email().domain()).escape_json() ++ ', ' ++ '"descriptionFirstLine":' ++ 
description.first_line().trim().escape_json() ++ ', ' ++ '"parents": [' ++ parents.map(|p| 
p.commit_id().short().escape_json()).join(",") ++ '], ' ++ '"localBookmarks": [' ++ 
local_bookmarks.map(|b| b.name().escape_json()).join(",") ++ '], ' ++ '"remoteBookmarks": [' ++
remote_bookmarks.map(|b| stringify(b.name() ++ '@' ++ b.remote()).escape_json()).join(",") ++ 
'], ' ++ '"isCurrentWorkingCopy":' ++ current_working_copy ++ ' }\n'`;

    // Build revset: from..to but exclude already seen commits
    let revset = `${from}..${to}`;
    if (lastSeenCommit) {
      revset = `(${from}..${to}) ~ ::${lastSeenCommit}`;
    }

    execFile(
      JJ_BINARY,
      [
        "log",
        "--revisions",
        revset,
        "--no-graph",
        "--limit",
        "100",
        "--template",
        jjTemplate,
      ],
      (error, stdout, stderr) => {
        if (error) {
          console.error(
            `Failed to get changes between ${from} and ${to}: ${(error as Error).toString()}`,
          );
          return reject(error as Error);
        }
        if (stderr) {
          console.error(`stderr: ${stderr}`);
        }

        const changes: LogEntry[] = [];
        const lines = stdout.trim().split("\n");

        for (const line of lines) {
          if (line.trim() === "") continue;
          try {
            changes.push(JSON.parse(line) as LogEntry);
          } catch (parseError) {
            console.error(`Failed to parse line: ${line}`, parseError);
          }
        }

        resolve(changes);
      },
    );
  });
}

/**
 * Traverse from a bookmark toward trunk, discovering segments and relationships along the way
 */
async function traverseAndDiscoverSegments(
  bookmark: Bookmark,
  commonAncestor: LogEntry,
  fullyCollectedBookmarks: Set<string>,
  bookmarkToCommitId: Map<string, string>,
  jj: JjFunctions,
): Promise<{
  segments: Array<{ bookmark: string; changes: LogEntry[] }>;
  baseBookmark?: string; // if we hit a fully-collected bookmark
  baseCommit: string;
}> {
  const segments: Array<{ bookmark: string; changes: LogEntry[] }> = [];
  let currentSegmentChanges: LogEntry[] = [];
  let currentBookmark = bookmark.name;
  let lastSeenCommit: string | undefined;
  let baseCommit = commonAncestor.commitId;
  let baseBookmark: string | undefined;

  while (true) {
    const changes = await jj.getChangesBetween(
      commonAncestor.commitId,
      bookmark.commitId,
      lastSeenCommit,
    );

    if (changes.length === 0) {
      break;
    }

    // Check for merge commits (more than one parent)
    for (const change of changes) {
      if (change.parents.length > 1) {
        throw new Error(
          `Found merge commit ${change.commitId} in branch ${bookmark.name}. This indicates a split/merge in the history which is not supported.`,
        );
      }
    }

    // Check each change for bookmarks, stopping if we find a fully-collected one
    let foundFullyCollected = false;
    for (const change of changes) {
      // Check if this change has any bookmarks
      let processedChange = false;

      for (const bookmarkName of change.localBookmarks) {
        if (bookmarkToCommitId.has(bookmarkName)) {
          if (fullyCollectedBookmarks.has(bookmarkName)) {
            // Found a fully-collected bookmark! Stop here
            console.log(
              `    Found fully-collected bookmark ${bookmarkName} at ${change.commitId}`,
            );
            baseBookmark = bookmarkName;
            baseCommit = change.commitId;

            // Complete current segment (don't include this bookmark's change)
            if (currentSegmentChanges.length > 0) {
              segments.push({
                bookmark: currentBookmark,
                changes: currentSegmentChanges,
              });
            }

            foundFullyCollected = true;
            processedChange = true;
            break;
          } else {
            // Found a bookmark that hasn't been fully collected yet
            // Complete the current segment and start a new one
            if (bookmarkName !== bookmark.name) {
              console.log(`    Found bookmark ${bookmarkName} on path`);

              // Complete current segment (don't include this bookmark's change)
              if (currentSegmentChanges.length > 0) {
                segments.push({
                  bookmark: currentBookmark,
                  changes: currentSegmentChanges,
                });
              }

              // Start new segment for the encountered bookmark
              currentBookmark = bookmarkName;
              currentSegmentChanges = [];
            }

            // Add this bookmark's change to its segment
            currentSegmentChanges.push(change);
            processedChange = true;
            break; // Only process first bookmark on this change
          }
        }
      }

      if (foundFullyCollected) {
        break;
      }

      // If this change didn't have any relevant bookmarks, add it to current segment
      if (!processedChange) {
        currentSegmentChanges.push(change);
      }
    }

    if (foundFullyCollected) {
      break;
    }

    if (changes.length < 100) {
      break; // We got all remaining changes
    }

    // Use the oldest commit in this batch as the cursor for the next page
    lastSeenCommit = changes[changes.length - 1].commitId;
  }

  // Add the final segment if it has changes
  if (currentSegmentChanges.length > 0) {
    segments.push({
      bookmark: currentBookmark,
      changes: currentSegmentChanges,
    });
  }

  return {
    segments,
    baseBookmark,
    baseCommit,
  };
}

/**
 * Group segments into stacks based on their relationships
 * Creates one stack per leaf bookmark, with each stack representing the full path from trunk to that leaf
 */
function groupSegmentsIntoStacks(
  bookmarks: Bookmark[],
  stackingRelationships: Map<string, string>,
  segmentChanges: Map<string, LogEntry[]>,
): BranchStack[] {
  const stacks: BranchStack[] = [];

  // Helper function to find all children of a given bookmark
  function findAllChildren(bookmark: string): string[] {
    const children: string[] = [];
    for (const [child, parent] of stackingRelationships.entries()) {
      if (parent === bookmark) {
        children.push(child);
      }
    }
    return children;
  }

  // Helper function to find all leaf bookmarks (bookmarks with no children)
  function findLeafBookmarks(): string[] {
    const allBookmarkNames = bookmarks.map((b) => b.name);
    const leafBookmarks: string[] = [];

    for (const bookmarkName of allBookmarkNames) {
      const children = findAllChildren(bookmarkName);
      if (children.length === 0) {
        leafBookmarks.push(bookmarkName);
      }
    }

    return leafBookmarks;
  }

  // Helper function to build a path from a leaf bookmark back to the root
  function buildPathToRoot(leafBookmark: string): string[] {
    const path: string[] = [leafBookmark];
    let current = leafBookmark;

    // Walk backwards through the stacking relationships to build the full path
    while (stackingRelationships.has(current)) {
      const parent = stackingRelationships.get(current)!;
      path.unshift(parent); // Add parent at the beginning
      current = parent;
    }

    return path;
  }

  // Find all leaf bookmarks and create a stack for each
  const leafBookmarks = findLeafBookmarks();

  for (const leafBookmark of leafBookmarks) {
    const stackBookmarks = buildPathToRoot(leafBookmark);
    const segments = buildSegmentsFromBookmarks(
      stackBookmarks,
      bookmarks,
      stackingRelationships,
      segmentChanges,
    );

    stacks.push({
      segments,
      baseCommit: segments.length > 0 ? segments[0].baseCommit : "trunk",
    });
  }

  return stacks;
}

// Helper function to build segments from a list of bookmark names
function buildSegmentsFromBookmarks(
  stackBookmarks: string[],
  bookmarks: Bookmark[],
  stackingRelationships: Map<string, string>,
  segmentChanges: Map<string, LogEntry[]>,
): BookmarkSegment[] {
  const segments: BookmarkSegment[] = [];

  for (const bookmarkName of stackBookmarks) {
    const bookmarkObj = bookmarks.find((b) => b.name === bookmarkName)!;
    const changes = segmentChanges.get(bookmarkName) || [];

    // Determine base commit for this segment
    const segmentBaseCommit = stackingRelationships.has(bookmarkName)
      ? bookmarks.find(
          (b) => b.name === stackingRelationships.get(bookmarkName)!,
        )!.commitId
      : "trunk";

    segments.push({
      bookmark: bookmarkObj,
      changes,
      baseCommit: segmentBaseCommit,
    });
  }

  return segments;
}

/**
 * Build a complete change graph by discovering all bookmark segments and their relationships
 */
export async function buildChangeGraph(jj?: JjFunctions): Promise<ChangeGraph> {
  // Use default implementations if no jj functions provided
  const jjFunctions = jj || {
    getMyBookmarks,
    findCommonAncestor,
    getChangesBetween,
  };

  console.log("Discovering user bookmarks...");
  const bookmarks = await jjFunctions.getMyBookmarks();

  if (bookmarks.length === 0) {
    console.log("No user bookmarks found.");
    return {
      bookmarks: [],
      stacks: [],
      segmentChanges: new Map(),
    };
  }

  console.log(
    `Found ${bookmarks.length} bookmarks: ${bookmarks.map((b) => b.name).join(", ")}`,
  );

  // Data structures for the optimized algorithm
  const fullyCollectedBookmarks = new Set<string>();
  const stackingRelationships = new Map<string, string>(); // child -> parent
  const segmentChanges = new Map<string, LogEntry[]>(); // bookmark name -> just its segment changes
  const bookmarkToCommitId = new Map<string, string>();
  const stackRoots = new Set<string>(); // Track which bookmarks are stack roots

  // Build bookmark lookup map
  for (const bookmark of bookmarks) {
    bookmarkToCommitId.set(bookmark.name, bookmark.commitId);
  }

  // Process each bookmark to collect segment changes
  for (const bookmark of bookmarks) {
    if (fullyCollectedBookmarks.has(bookmark.name)) {
      console.log(`Skipping already processed bookmark: ${bookmark.name}`);
      continue;
    }

    console.log(`Processing bookmark: ${bookmark.name}`);

    try {
      // Find common ancestor with trunk (like before)
      const commonAncestor = await jjFunctions.findCommonAncestor(
        bookmark.name,
      );

      // Use optimized collection that can stop early when hitting fully-collected bookmarks
      const result = await traverseAndDiscoverSegments(
        bookmark,
        commonAncestor,
        fullyCollectedBookmarks,
        bookmarkToCommitId,
        jjFunctions,
      );

      // Store segment changes for all bookmarks found in the result
      for (const segment of result.segments) {
        segmentChanges.set(segment.bookmark, segment.changes);
        fullyCollectedBookmarks.add(segment.bookmark);

        console.log(
          `    Found segment for ${segment.bookmark}: ${segment.changes.length} changes`,
        );
      }

      // Establish stacking relationships based on the segment order
      // Segments are returned in order from target back to base, so we need to reverse for stacking
      for (let i = 0; i < result.segments.length - 1; i++) {
        const childSegment = result.segments[i];
        const parentSegment = result.segments[i + 1];
        stackingRelationships.set(
          childSegment.bookmark,
          parentSegment.bookmark,
        );
        console.log(
          `    Stacking: ${childSegment.bookmark} -> ${parentSegment.bookmark}`,
        );
      }

      // If we hit a fully-collected bookmark, establish relationship to it
      if (result.baseBookmark && result.segments.length > 0) {
        const rootSegment = result.segments[result.segments.length - 1];
        stackingRelationships.set(rootSegment.bookmark, result.baseBookmark);
        console.log(
          `    Stacking: ${rootSegment.bookmark} -> ${result.baseBookmark}`,
        );
      } else if (result.segments.length > 0) {
        // We reached trunk, so the last segment is a root
        const rootSegment = result.segments[result.segments.length - 1];
        stackRoots.add(rootSegment.bookmark);
        console.log(`    Root bookmark identified: ${rootSegment.bookmark}`);
      }

      console.log(
        `  Processed ${bookmark.name} - found ${result.segments.length} segments`,
      );
    } catch (error) {
      console.error(`Failed to process bookmark ${bookmark.name}:`, error);
      throw error;
    }
  }

  // Debug: log the stacking relationships we discovered
  console.log("=== STACKING RELATIONSHIPS ===");
  for (const [child, parent] of stackingRelationships.entries()) {
    console.log(`${child} -> ${parent}`);
  }
  if (stackingRelationships.size === 0) {
    console.log("No stacking relationships found");
  }

  // Debug: log the stack roots we identified
  console.log("=== STACK ROOTS ===");
  for (const root of stackRoots) {
    console.log(`Root: ${root}`);
  }
  if (stackRoots.size === 0) {
    console.log("No stack roots found");
  }

  // Group segments into stacks based on relationships
  const stacks = groupSegmentsIntoStacks(
    bookmarks,
    stackingRelationships,
    segmentChanges,
  );

  return {
    bookmarks,
    stacks,
    segmentChanges,
  };
}

// Default implementations
export const defaultJjFunctions: JjFunctions = {
  getMyBookmarks,
  findCommonAncestor,
  getChangesBetween,
};
