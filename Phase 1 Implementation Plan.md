Phase 1 Implementation Plan Status Enhancement
Overview
Enhance the existing buildChangeGraph() function to include bookmark sync status information by integrating jj git fetch and parsing bookmark synchronization data.

Current State Analysis
Existing Code Structure
Location: jjUtils.ts
Main function: buildChangeGraph() (lines ~430-584)
Key functions:
getMyBookmarks() - Gets user bookmarks
findCommonAncestor() - Finds common ancestor with trunk
getChangesBetween() - Gets changes between commits
Data types: Defined in jjTypes.ts
Current Data Collection
The existing LogEntry type already collects:

localBookmarks: string[]
remoteBookmarks: string[] (format: "bookmark@remote")
However, this data is collected at the commit level, not at the bookmark level, and doesn't include sync status.

Implementation Tasks
Task 1: Extend Type Definitions
File: jjTypes.ts

Modify the existing `getMyBookmarks()` function to include sync status information by checking whether each bookmark has a corresponding remote bookmark with the same target.

```
export interface BookmarkWithSyncInfo extends Bookmark {
  isSynced: boolean;       // True if local and remote are identical, false if needs push/pull
  hasRemote: boolean;      // True if bookmark has a remote counterpart
  hasOpenPR?: boolean;     // To be added in Phase 2
}
```

Task 2: Modify getMyBookmarks Function
File: jjUtils.ts

Update the existing function to collect sync status information:

```
/**
 * Get all bookmarks created by the current user with sync status
 */
export function getMyBookmarks(): Promise<BookmarkWithSyncInfo[]> {
  return new Promise((resolve, reject) => {
    // Template to extract bookmark info including local and remote bookmarks
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
        "--all-remotes",
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

        const bookmarks: BookmarkWithSyncInfo[] = [];
        const lines = stdout.trim().split("\n");

        for (const line of lines) {
          if (line.trim() === "") continue;

          try {
            const bookmarkData = JSON.parse(line);

            // Check if this bookmark has a remote counterpart
            const hasRemote = bookmarkData.remoteBookmarks.some((remote: string) =>
              remote.startsWith(bookmarkData.name + "@")
            );

            // Check if synced (local bookmark appears in remote bookmarks list)
            const isSynced = hasRemote && bookmarkData.localBookmarks.includes(bookmarkData.name);

            const bookmark: BookmarkWithSyncInfo = {
              name: bookmarkData.name,
              commitId: bookmarkData.commitId,
              changeId: bookmarkData.changeId,
              isSynced,
              hasRemote,
            };

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
```

Task 3: Add Git Fetch Function
File: jjUtils.ts

Add git fetch functionality:

```
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
          console.error(`Failed to fetch from remotes: ${error.toString()}`);
          return reject(error);
        }
        if (stderr) {
          console.warn(`Git fetch warnings: ${stderr}`);
        }
        console.log("Successfully fetched from all remotes");
        resolve();
      }
    );
  });
}
```

Task 4: Update buildChangeGraph Function
File: jjUtils.ts

Modify the buildChangeGraph function to use git fetch and updated getMyBookmarks:

```
export async function buildChangeGraph(jj?: JjFunctions): Promise<ChangeGraph> {
  // Add git fetch at the beginning
  console.log("Fetching latest changes from remotes...");
  await gitFetch();

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

  // Log sync status for each bookmark
  for (const bookmark of bookmarks) {
    const syncStatus = bookmark.isSynced ? "synced" :
                      bookmark.hasRemote ? "needs push/pull" : "no remote";
    console.log(`Bookmark ${bookmark.name}: ${syncStatus}`);
  }

  // ... existing logic for processing bookmarks and building stacks remains the same ...

  return {
    bookmarks,
    stacks, // existing stacks logic
    segmentChanges, // existing segmentChanges logic
  };
}
```

Task 5: Update Type Definitions and Dependencies
File: jjUtils.ts

Update the JjFunctions type to use the new return type:

```
export type JjFunctions = {
  getMyBookmarks: () => Promise<BookmarkWithSyncInfo[]>;
  findCommonAncestor: (bookmarkName: string) => Promise<LogEntry>;
  getChangesBetween: (from: string, to: string, lastSeenCommit?: string) => Promise<LogEntry[]>;
};

export const defaultJjFunctions: JjFunctions = {
  getMyBookmarks,
  findCommonAncestor,
  getChangesBetween,
};
```

Update the ChangeGraph type in jjTypes.ts:

```
export interface ChangeGraph {
  bookmarks: BookmarkWithSyncInfo[];  // Changed from Bookmark[]
  stacks: BranchStack[];
  segmentChanges: Map<string, LogEntry[]>;
}
```

Task 6: Update ReScript Interface
File: AnalyzeCommand.res

Update the type definitions to match the new TypeScript types:

```
type bookmarkWithSyncInfo = {
  name: string,
  commitId: string,
  changeId: string,
  isSynced: bool,
  hasRemote: bool,
  hasOpenPR: option<bool>,
}

type changeGraph = {
  bookmarks: array<bookmarkWithSyncInfo>,
  stacks: array<branchStack>,
  segmentChanges: Map.t<string, array<logEntry>>,
}
```

Task 7: Update Module Export
File: AnalyzeCommand.res

Update the export to match the unchanged return type:

```
@module("../lib/jjUtils.js")
external buildChangeGraph: unit => promise<changeGraph> = "buildChangeGraph"
```

Testing Strategy
Unit Tests to Add
File: jjUtils.test.ts

- Test gitFetch() function with mocked execFile
- Test updated getMyBookmarks() with various sync scenarios:
  - Bookmarks with no remote (hasRemote: false, isSynced: false)
  - Bookmarks that are synced (hasRemote: true, isSynced: true)
  - Bookmarks that need push/pull (hasRemote: true, isSynced: false)
- Test enhanced buildChangeGraph() integration
  Manual Testing
  Test with repository that has:
- Local bookmarks with no remotes (should show hasRemote: false, isSynced: false)
- Local bookmarks that are synced with remotes (should show hasRemote: true, isSynced: true)
- Local bookmarks that need to be pushed (should show hasRemote: true, isSynced: false)
- Test after making changes on GitHub to verify detection of out-of-sync state
  Notes for Implementation
  Dependencies
- No new npm dependencies required
- Uses existing execFile from Node.js child_process
- Uses existing JJ binary path: jj-v0.30.0-aarch64-apple-darwin

Error Handling

- Follow existing patterns in the codebase
- Log errors but don't fail the entire operation if sync status can't be determined
- Graceful degradation: if sync status fails, bookmarks should still work with default sync values

Performance Considerations

- jj git fetch may take time depending on network/repo size
- Consider adding timeout handling
- jj bookmark list --all-remotes should be fast as it's local data after fetch

Template Logic

- The sync detection logic relies on the jj bookmark list output format
- For synced bookmarks: the local bookmark name appears in both localBookmarks and remoteBookmarks arrays
- For out-of-sync bookmarks: only the remote bookmark (name@remote) appears in remoteBookmarks
- For local-only bookmarks: remoteBookmarks array is empty

Future Extensibility

- The BookmarkWithSyncInfo type includes hasOpenPR field for Phase 2
- The boolean sync status can be enhanced later to provide more detailed sync information if needed
- Additional remote handling can be added later
  Completion Criteria
- [ ] All new functions compile without errors
- [ ] Existing buildChangeGraph() usage in AnalyzeCommand.res continues to work
- [ ] Console output shows sync status for each bookmark (synced/needs push/no remote)
- [ ] Manual testing confirms sync status accuracy in various scenarios
- [ ] No breaking changes to existing API (ChangeGraph type updated but interface remains compatible)
