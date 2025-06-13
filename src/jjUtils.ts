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
      ["log", "--no-graph", "-T", jjTemplate],
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
    execFile(
      JJ_BINARY,
      ["bookmark", "list", "-r", "mine()"],
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

          // Parse format: "bookmark_name: change_id commit_id description"
          const match = line.match(/^(\S+):\s+(\S+)\s+(\S+)\s+(.*)$/);
          if (match) {
            const [, name, change_id, commit_id] = match;
            bookmarks.push({ name, commit_id, change_id });
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
        "-r",
        `ancestors(${bookmarkName}) & ancestors(trunk())`,
        "--no-graph",
        "-n",
        "1",
        "-T",
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
      ["log", "-r", revset, "--no-graph", "--limit", "100", "-T", jjTemplate],
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
 * Build a complete change graph from all user bookmarks
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

  const allChanges = new Map<string, LogEntry[]>();
  const bookmarkToAncestor = new Map<string, LogEntry>();

  // Get all changes for each bookmark
  for (const bookmark of bookmarks) {
    console.log(`Processing bookmark: ${bookmark.name}`);

    try {
      const commonAncestor = await findCommonAncestor(bookmark.name);
      bookmarkToAncestor.set(bookmark.name, commonAncestor);

      const changes = await getAllChangesBetween(bookmark, commonAncestor);
      allChanges.set(bookmark.name, changes);

      console.log(
        `  Found ${changes.length} changes between ${bookmark.name} and trunk`,
      );
    } catch (error) {
      console.error(`Failed to process bookmark ${bookmark.name}:`, error);
      throw error;
    }
  }

  // Identify stacked bookmarks
  const stacks = identifyStacks(bookmarks, bookmarkToAncestor, allChanges);

  return {
    bookmarks,
    stacks,
    allChanges,
  };
}

/**
 * Identify which bookmarks are stacked on top of each other
 */
function identifyStacks(
  bookmarks: Bookmark[],
  bookmarkToAncestor: Map<string, LogEntry>,
  allChanges: Map<string, LogEntry[]>,
): BranchStack[] {
  const stacks: BranchStack[] = [];
  const processedBookmarks = new Set<string>();

  for (const bookmark of bookmarks) {
    if (processedBookmarks.has(bookmark.name)) {
      continue;
    }

    const stack: BranchStack = {
      bookmarks: [bookmark],
      baseCommit: bookmarkToAncestor.get(bookmark.name)!.commit_id,
      changes: allChanges.get(bookmark.name) || [],
    };

    // Find other bookmarks that are stacked on this one
    const bookmarkCommitIds = new Set(stack.changes.map((c) => c.commit_id));

    for (const otherBookmark of bookmarks) {
      if (
        otherBookmark.name === bookmark.name ||
        processedBookmarks.has(otherBookmark.name)
      ) {
        continue;
      }

      const otherAncestor = bookmarkToAncestor.get(otherBookmark.name)!;

      // Check if this bookmark's base is in our change history
      if (bookmarkCommitIds.has(otherAncestor.commit_id)) {
        stack.bookmarks.push(otherBookmark);
        const otherChanges = allChanges.get(otherBookmark.name) || [];
        stack.changes.push(...otherChanges);
        processedBookmarks.add(otherBookmark.name);
      }
    }

    processedBookmarks.add(bookmark.name);
    stacks.push(stack);
  }

  return stacks;
}
