import { execFile } from "child_process"; // Changed from 'exec' to 'execFile'
import type {
  LogEntry,
  Bookmark,
  BranchStack,
  ChangeGraph,
  BookmarkSegment,
} from "./jjTypes.js";
import * as v from "valibot";

const JJ_BINARY = "/Users/keane/code/jj-v0.30.0-aarch64-apple-darwin";

// Types for dependency injection
export type JjFunctions = {
  gitFetch: () => Promise<void>;
  getMyBookmarks: () => Promise<Bookmark[]>;
  getBranchChangesPaginated: (
    from: string,
    to: string,
    lastSeenCommit?: string,
  ) => Promise<LogEntry[]>;
};

/**
 * Fetch latest changes from all git remotes
 */
export function gitFetch(): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      JJ_BINARY,
      ["git", "fetch", "--all-remotes"],
      (error, stdout, stderr) => {
        if (error) {
          console.error(
            `Failed to fetch from remotes: ${(error as Error).toString()}`,
          );
          return reject(error as Error);
        }
        if (stderr) {
          console.warn(`Git fetch warnings: ${stderr}`);
        }
        console.log("Successfully fetched from all remotes");
        resolve();
      },
    );
  });
}

const BookmarkOutputSchema = v.object({
  name: v.string(),
  commitId: v.string(),
  changeId: v.string(),
  localBookmarks: v.array(v.string()),
  remoteBookmarks: v.array(v.string()),
});

/**
 * Get all bookmarks created by the current user
 */
export function getMyBookmarks(): Promise<Bookmark[]> {
  return new Promise((resolve, reject) => {
    const bookmarkTemplate = `'{ "name":' ++ name.escape_json() ++ ', ' ++
    '"commitId":' ++ normal_target.commit_id().short().escape_json() ++ ', ' ++
    '"changeId":' ++ normal_target.change_id().short().escape_json() ++ ', ' ++
    '"localBookmarks": [' ++ normal_target.local_bookmarks().map(|b| b.name().escape_json()).join(",") ++ '], ' ++
    '"remoteBookmarks": [' ++ normal_target.remote_bookmarks().map(|b| stringify(b.name() ++ "@" ++ b.remote()).escape_json()).join(",") ++ '] }\n'`;

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

        const bookmarks = new Map<string, Bookmark>();
        const lines = stdout.trim().split("\n");

        for (const line of lines) {
          if (line.trim() === "") continue;

          try {
            const bookmark = v.parse(BookmarkOutputSchema, JSON.parse(line));

            const existingBookmark = bookmarks.get(bookmark.name);
            if (!existingBookmark) {
              bookmarks.set(bookmark.name, {
                name: bookmark.name,
                commitId: bookmark.commitId,
                changeId: bookmark.changeId,
                hasRemote: !!bookmark.remoteBookmarks.length,
                isSynced:
                  !!bookmark.localBookmarks.length &&
                  !!bookmark.remoteBookmarks.length,
              });
            } else {
              existingBookmark.hasRemote ||= !!bookmark.remoteBookmarks.length;
              if (
                !bookmark.localBookmarks.length &&
                bookmark.remoteBookmarks.length
              ) {
                // We found a tracked remote bookmark that points to a commit without local bookmarks.
                // This means the local bookmark has at least one out of sync remote.
                existingBookmark.isSynced = false;
              }
            }
          } catch (error) {
            console.error(`Failed to parse bookmark line: ${line}`, error);
            reject(error as Error);
          }
        }

        resolve(Array.from(bookmarks.values()));
      },
    );
  });
}

const LogEntrySchema = v.object({
  commitId: v.string(),
  changeId: v.string(),
  authorName: v.string(),
  authorEmail: v.string(),
  descriptionFirstLine: v.string(),
  parents: v.array(v.string()),
  localBookmarks: v.array(v.string()),
  remoteBookmarks: v.array(v.string()),
  isCurrentWorkingCopy: v.boolean(),
});

/**
 * Get changes that are ancestors of `to` that are not ancestors of `trunk`. The result
 * will include `to` itself, but not `trunk`.
 */
export function getBranchChangesPaginated(
  trunk: string,
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

    // Build revset: trunk..to but exclude already seen commits
    const revset = lastSeenCommit
      ? `(${trunk}..${to}) ~ ${lastSeenCommit}::`
      : `${trunk}..${to}`;

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
            `Failed to get changes (trunk ${trunk}, to ${to}): ${(error as Error).toString()}`,
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
            changes.push(v.parse(LogEntrySchema, JSON.parse(line)));
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
  trunkRev: string,
  fullyCollectedBookmarks: Set<string>,
  jj: JjFunctions,
): Promise<{
  segments: Array<{ bookmark: string; changes: LogEntry[] }>;
  baseBookmark?: string; // if we hit a fully-collected bookmark
}> {
  const segments: Array<{ bookmark: string; changes: LogEntry[] }> = [];
  let currentSegmentChanges: LogEntry[] = [];
  let currentBookmark = bookmark.name;
  let lastSeenCommit: string | undefined;
  let baseBookmark: string | undefined;

  while (true) {
    const changes = await jj.getBranchChangesPaginated(
      trunkRev,
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
        if (fullyCollectedBookmarks.has(bookmarkName)) {
          // Found a fully-collected bookmark! Stop here
          console.log(
            `    Found fully-collected bookmark ${bookmarkName} at ${change.commitId}`,
          );
          baseBookmark = bookmarkName;

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
  const jjFunctions: JjFunctions = jj || {
    gitFetch,
    getMyBookmarks,
    getBranchChangesPaginated,
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
  const stackRoots = new Set<string>(); // Track which bookmarks are stack roots

  // Process each bookmark to collect segment changes
  for (const bookmark of bookmarks) {
    if (fullyCollectedBookmarks.has(bookmark.name)) {
      console.log(`Skipping already processed bookmark: ${bookmark.name}`);
      continue;
    }

    console.log(`Processing bookmark: ${bookmark.name}`);

    try {
      const trunkRev = "trunk()";

      // Use optimized collection that can stop early when hitting fully-collected bookmarks
      const result = await traverseAndDiscoverSegments(
        bookmark,
        trunkRev,
        fullyCollectedBookmarks,
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
  gitFetch,
  getMyBookmarks,
  getBranchChangesPaginated,
};
