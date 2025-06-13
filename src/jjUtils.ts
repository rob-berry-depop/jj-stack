import { execFile } from "child_process"; // Changed from 'exec' to 'execFile'
import type { LogEntry, Bookmark, BranchStack, ChangeGraph } from "./jjTypes";

const JJ_BINARY = "/Users/keane/code/jj-v0.30.0-aarch64-apple-darwin";

export function getLogOutput(): Promise<LogEntry[]> {
  return new Promise((resolve, reject) => {
    const jjTemplate = `'{ "commit_id":' ++ commit_id.short().escape_json() ++ ', ' ++ '"change_id":' 
++ change_id.short().escape_json() ++ ', ' ++ '"author_name":' ++ author.name().escape_json() ++ 
', ' ++ '"author_email":' ++ stringify(author.email().local() ++ '@' ++
author.email().domain()).escape_json() ++ ', ' ++ '"description_first_line":' ++ 
description.first_line().trim().escape_json() ++ ', ' ++ '"parents": [' ++ parents.map(|p| 
p.commit_id().short().escape_json()).join(",") ++ '], ' ++ '"local_bookmarks": [' ++ 
local_bookmarks.map(|b| b.name().escape_json()).join(",") ++ '], ' ++ '"remote_bookmarks": [' ++
remote_bookmarks.map(|b| stringify(b.name() ++ '@' ++ b.remote()).escape_json()).join(",") ++ 
'], ' ++ '"is_current_working_copy":' ++ current_working_copy ++ ' }\n'`;

    execFile(
      JJ_BINARY,
      ["log", "--no-graph", "--template", jjTemplate],
      (error, stdout, stderr) => {
        if (error) {
          console.error(`execFile error: ${(error as Error).toString()}`);
          return reject(error as Error);
        }
        if (stderr) {
          console.error(`stderr: ${stderr}`);
        }

        resolve(
          stdout
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line) as LogEntry),
        );
      },
    );
  });
}

/**
 * Get all bookmarks created by the current user
 */
export function getMyBookmarks(): Promise<Bookmark[]> {
  return new Promise((resolve, reject) => {
    const bookmarkTemplate = `'{ "name":' ++ name.escape_json() ++ ', ' ++ '"commit_id":' ++ normal_target.commit_id().short().escape_json() ++ ', ' ++ '"change_id":' ++ normal_target.change_id().short().escape_json() ++ ' }\n'`;

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
    const jjTemplate = `'{ "commit_id":' ++ commit_id.short().escape_json() ++ ', ' ++ '"change_id":' 
++ change_id.short().escape_json() ++ ', ' ++ '"author_name":' ++ author.name().escape_json() ++ 
', ' ++ '"author_email":' ++ stringify(author.email().local() ++ '@' ++
author.email().domain()).escape_json() ++ ', ' ++ '"description_first_line":' ++ 
description.first_line().trim().escape_json() ++ ', ' ++ '"parents": [' ++ parents.map(|p| 
p.commit_id().short().escape_json()).join(",") ++ '], ' ++ '"local_bookmarks": [' ++ 
local_bookmarks.map(|b| b.name().escape_json()).join(",") ++ '], ' ++ '"remote_bookmarks": [' ++
remote_bookmarks.map(|b| stringify(b.name() ++ '@' ++ b.remote()).escape_json()).join(",") ++ 
'], ' ++ '"is_current_working_copy":' ++ current_working_copy ++ ' }\n'`;

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
    const jjTemplate = `'{ "commit_id":' ++ commit_id.short().escape_json() ++ ', ' ++ '"change_id":' 
++ change_id.short().escape_json() ++ ', ' ++ '"author_name":' ++ author.name().escape_json() ++ 
', ' ++ '"author_email":' ++ stringify(author.email().local() ++ '@' ++
author.email().domain()).escape_json() ++ ', ' ++ '"description_first_line":' ++ 
description.first_line().trim().escape_json() ++ ', ' ++ '"parents": [' ++ parents.map(|p| 
p.commit_id().short().escape_json()).join(",") ++ '], ' ++ '"local_bookmarks": [' ++ 
local_bookmarks.map(|b| b.name().escape_json()).join(",") ++ '], ' ++ '"remote_bookmarks": [' ++
remote_bookmarks.map(|b| stringify(b.name() ++ '@' ++ b.remote()).escape_json()).join(",") ++ 
'], ' ++ '"is_current_working_copy":' ++ current_working_copy ++ ' }\n'`;

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
 * Collect all changes between a bookmark and its common ancestor with trunk
 */
export async function getAllChangesBetween(
  bookmark: Bookmark,
  commonAncestor: LogEntry,
): Promise<LogEntry[]> {
  const allChanges: LogEntry[] = [];
  let lastSeenCommit: string | undefined;

  while (true) {
    const changes = await getChangesBetween(
      commonAncestor.commit_id,
      bookmark.commit_id,
      lastSeenCommit,
    );

    if (changes.length === 0) {
      break;
    }

    // Check for merge commits (more than one parent)
    for (const change of changes) {
      if (change.parents.length > 1) {
        throw new Error(
          `Found merge commit ${change.commit_id} in branch ${bookmark.name}. This indicates a split/merge in the history which is not supported.`,
        );
      }
    }

    allChanges.push(...changes);

    if (changes.length < 100) {
      break; // We got all remaining changes
    }

    // Use the oldest commit in this batch as the cursor for the next page
    lastSeenCommit = changes[changes.length - 1].commit_id;
  }

  return allChanges;
}

/**
 * Collect changes between two commits with early termination when hitting fully-collected bookmarks
 */
async function getAllChangesBetweenOptimized(
  bookmark: Bookmark,
  commonAncestor: LogEntry,
  fullyCollectedBookmarks: Set<string>,
  bookmarkToCommitId: Map<string, string>,
): Promise<{
  changes: LogEntry[];
  baseBookmark?: string; // if we hit a fully-collected bookmark
  baseCommit: string;
  pathBookmarks: string[]; // bookmarks encountered on the path
}> {
  const allChanges: LogEntry[] = [];
  const pathBookmarks: string[] = [];
  let lastSeenCommit: string | undefined;
  let baseCommit = commonAncestor.commit_id;
  let baseBookmark: string | undefined;

  while (true) {
    const changes = await getChangesBetween(
      commonAncestor.commit_id,
      bookmark.commit_id,
      lastSeenCommit,
    );

    if (changes.length === 0) {
      break;
    }

    // Check for merge commits (more than one parent)
    for (const change of changes) {
      if (change.parents.length > 1) {
        throw new Error(
          `Found merge commit ${change.commit_id} in branch ${bookmark.name}. This indicates a split/merge in the history which is not supported.`,
        );
      }
    }

    // Check each change for bookmarks, stopping if we find a fully-collected one
    let foundFullyCollected = false;
    for (let i = 0; i < changes.length; i++) {
      const change = changes[i];

      // Check if this change has any bookmarks
      for (const bookmarkName of change.local_bookmarks) {
        if (bookmarkToCommitId.has(bookmarkName)) {
          if (fullyCollectedBookmarks.has(bookmarkName)) {
            // Found a fully-collected bookmark! Stop here and truncate
            console.log(
              `    Found fully-collected bookmark ${bookmarkName} at ${change.commit_id}`,
            );
            baseBookmark = bookmarkName;
            baseCommit = change.commit_id;
            // Only include changes up to (but not including) this bookmark
            allChanges.push(...changes.slice(0, i));
            foundFullyCollected = true;
            break;
          } else {
            // Track this bookmark in our path (but skip the starting bookmark itself)
            if (bookmarkName !== bookmark.name) {
              pathBookmarks.push(bookmarkName);
              console.log(`    Found bookmark ${bookmarkName} on path`);
            }
          }
        }
      }

      if (foundFullyCollected) {
        break;
      }
    }

    if (foundFullyCollected) {
      break;
    }

    // If we didn't find a fully-collected bookmark, add all changes
    allChanges.push(...changes);

    if (changes.length < 100) {
      break; // We got all remaining changes
    }

    // Use the oldest commit in this batch as the cursor for the next page
    lastSeenCommit = changes[changes.length - 1].commit_id;
  }

  return {
    changes: allChanges,
    baseBookmark,
    baseCommit,
    pathBookmarks,
  };
}

/**
 * Build stacks from stacking relationships
 */
function buildStacksFromRelationships(
  bookmarks: Bookmark[],
  stackingRelationships: Map<string, string>,
  allChanges: Map<string, LogEntry[]>,
): BranchStack[] {
  const stacks: BranchStack[] = [];
  const processedBookmarks = new Set<string>();

  for (const bookmark of bookmarks) {
    if (processedBookmarks.has(bookmark.name)) {
      continue;
    }

    // Find the root of this stack (bookmark with no parent in relationships)
    let current = bookmark.name;
    const stackBookmarks: Bookmark[] = [];

    // Collect all bookmarks in this stack
    while (current) {
      const bookmarkObj = bookmarks.find((b) => b.name === current)!;
      stackBookmarks.unshift(bookmarkObj); // Add to front to get bottom-to-top order
      processedBookmarks.add(current);

      const parent = stackingRelationships.get(current);
      current = parent && !processedBookmarks.has(parent) ? parent : "";
    }

    // Build the stack
    const rootBookmark = stackBookmarks[0];
    const allStackChanges: LogEntry[] = [];

    // Collect all changes for the entire stack
    for (const stackBookmark of stackBookmarks) {
      const bookmarkChanges = allChanges.get(stackBookmark.name) || [];
      allStackChanges.push(...bookmarkChanges);
    }

    // Find base commit (we'll use the common ancestor approach for now)
    // This could be optimized further but let's keep it simple
    let baseCommit = "trunk"; // Default fallback
    try {
      const commonAncestor = stackingRelationships.has(rootBookmark.name)
        ? rootBookmark.commit_id // If it's stacked, use its commit as base
        : "trunk"; // If it's not stacked, find common ancestor with trunk
      baseCommit = commonAncestor;
    } catch {
      // Fallback to trunk if we can't find ancestor
      baseCommit = "trunk";
    }

    stacks.push({
      bookmarks: stackBookmarks,
      baseCommit,
      changes: allStackChanges,
    });
  }

  return stacks;
}

/**
 * Build a complete change graph from all user bookmarks using optimized graph traversal
 */
export async function buildChangeGraph(): Promise<ChangeGraph> {
  console.log("Discovering user bookmarks...");
  const bookmarks = await getMyBookmarks();

  if (bookmarks.length === 0) {
    console.log("No user bookmarks found.");
    return {
      bookmarks: [],
      stacks: [],
      allChanges: new Map(),
    };
  }

  console.log(
    `Found ${bookmarks.length} bookmarks: ${bookmarks.map((b) => b.name).join(", ")}`,
  );

  // Data structures for the optimized algorithm
  const fullyCollectedBookmarks = new Set<string>();
  const stackingRelationships = new Map<string, string>(); // child -> parent
  const allChanges = new Map<string, LogEntry[]>();
  const bookmarkToCommitId = new Map<string, string>();

  // Build bookmark lookup map
  for (const bookmark of bookmarks) {
    bookmarkToCommitId.set(bookmark.name, bookmark.commit_id);
  }

  // Process each bookmark
  for (const bookmark of bookmarks) {
    if (fullyCollectedBookmarks.has(bookmark.name)) {
      console.log(`Skipping already processed bookmark: ${bookmark.name}`);
      continue;
    }

    console.log(`Processing bookmark: ${bookmark.name}`);

    try {
      // Find common ancestor with trunk (like before)
      const commonAncestor = await findCommonAncestor(bookmark.name);

      // Use optimized collection that can stop early when hitting fully-collected bookmarks
      const result = await getAllChangesBetweenOptimized(
        bookmark,
        commonAncestor,
        fullyCollectedBookmarks,
        bookmarkToCommitId,
      );

      // Build the complete change list for this bookmark
      let bookmarkChanges = [...result.changes];

      // If we hit a fully-collected bookmark, include its changes too
      if (result.baseBookmark && allChanges.has(result.baseBookmark)) {
        bookmarkChanges = [
          ...allChanges.get(result.baseBookmark)!,
          ...bookmarkChanges,
        ];
      }

      allChanges.set(bookmark.name, bookmarkChanges);
      fullyCollectedBookmarks.add(bookmark.name);

      // Establish stacking relationship if we hit a fully-collected bookmark
      if (result.baseBookmark) {
        stackingRelationships.set(bookmark.name, result.baseBookmark);
      }

      // Process bookmarks found on the path
      let currentParent = result.baseBookmark || null;
      for (let i = result.pathBookmarks.length - 1; i >= 0; i--) {
        const pathBookmark = result.pathBookmarks[i];

        if (!fullyCollectedBookmarks.has(pathBookmark)) {
          // For path bookmarks, we need to collect their individual changes
          // For now, let's use the same approach but we could optimize this further
          const pathBookmarkObj = bookmarks.find(
            (b) => b.name === pathBookmark,
          )!;
          const pathCommonAncestor = currentParent
            ? {
                commit_id: bookmarkToCommitId.get(currentParent)!,
                change_id: "",
                author_name: "",
                author_email: "",
                description_first_line: "",
                parents: [],
                local_bookmarks: [],
                remote_bookmarks: [],
                is_current_working_copy: false,
              }
            : await findCommonAncestor(pathBookmark);

          const pathChanges = await getAllChangesBetween(
            pathBookmarkObj,
            pathCommonAncestor,
          );

          // Build complete change list for path bookmark
          let pathBookmarkChanges = [...pathChanges];
          if (currentParent && allChanges.has(currentParent)) {
            pathBookmarkChanges = [
              ...allChanges.get(currentParent)!,
              ...pathBookmarkChanges,
            ];
          }

          allChanges.set(pathBookmark, pathBookmarkChanges);
          fullyCollectedBookmarks.add(pathBookmark);

          // Establish stacking relationship
          if (currentParent) {
            stackingRelationships.set(pathBookmark, currentParent);
          }
        }

        currentParent = pathBookmark;
      }

      // Update the stacking relationship for the original bookmark if there were path bookmarks
      if (result.pathBookmarks.length > 0) {
        // The bookmark should be stacked on the last bookmark in the path (closest to trunk)
        const parentBookmark = result.pathBookmarks[result.pathBookmarks.length - 1];
        stackingRelationships.set(bookmark.name, parentBookmark);
      }

      console.log(
        `  Processed ${bookmark.name} - found ${bookmarkChanges.length} total changes`,
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

  // Build stacks from the stacking relationships
  const stacks = buildStacksFromRelationships(
    bookmarks,
    stackingRelationships,
    allChanges,
  );

  return {
    bookmarks,
    stacks,
    allChanges,
  };
}
