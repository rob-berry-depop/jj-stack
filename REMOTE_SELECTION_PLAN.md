# Remote Selection Implementation Plan

Support configurable Git remotes instead of hardcoded "origin" for GitHub operations, with CLI-based remote selection.

## Phase 1: Refactor Library to Accept Remote Parameter

**Goal**: Make the library flexible to accept any remote name, but keep CLI hardcoded to "origin"
**Can be merged**: Yes - no breaking changes, just internal refactoring

### Changes:

1. **Update `JjFunctions` interface** to include remote parameter:

   ```typescript
   export type JjFunctions = {
     // ...existing methods...
     pushBookmark: (bookmarkName: string, remote: string) => Promise<void>;
     getGitRemoteList: () => Promise<Array<{ name: string; url: string }>>;
   };
   ```

2. **Update `getGitHubRepoInfo`** to accept remote name:

   ```typescript
   export async function getGitHubRepoInfo(
     jj: JjFunctions,
     remoteName: string,
   ): Promise<{ owner: string; repo: string }>;
   ```

3. **Update `SubmissionPlan`** to track which remote is being used:

   ```typescript
   export interface SubmissionPlan {
     // ...existing fields...
     remoteName: string; // NEW
   }
   ```

4. **Update all functions** that currently hardcode "origin" to accept/use the remote parameter

5. **CLI remains mostly unchanged** - just passes "origin" everywhere

---

## Phase 2: Add Remote Validation

**Goal**: Add utilities to validate remotes are GitHub remotes and handle edge cases
**Can be merged**: Yes - pure addition, no behavior changes yet

### Changes:

1. **Add remote validation utilities** in `jjUtils.ts`:

   ```typescript
   export function isGitHubRemote(remoteUrl: string): boolean;
   export function filterGitHubRemotes(
     remotes: Array<{ name: string; url: string }>,
   ): Array<{ name: string; url: string }>;
   ```

2. **Add error handling** for invalid remotes in `getGitHubRepoInfo`; that means throwing errors, not swallowing them

---

## Phase 3: Add CLI --remote Flag Support

**Goal**: Allow users to specify remote via command line flag
**Can be merged**: Yes - additive feature, backwards compatible

### Changes:

1. **Update CLI argument parsing** in ReScript to accept `--remote` flag. The flag should be accepted no matter which subcommand is used.

2. **Update submit command** to use provided remote or default to "origin"

3. **Add validation** in CLI to ensure specified remote exists and is a GitHub remote

4. **Update documentation** with the new flag, including help text and README.md

---

## Phase 4: Add Remote Auto-Detection Logic

**Goal**: Automatically use the only remote if there's exactly one GitHub remote
**Can be merged**: Yes - smart defaults, no breaking changes

### Changes:

1. **Add remote resolution function** in CLI:

   ```typescript
   // If --remote specified: use it
   // If exactly one GitHub remote: use it
   // If multiple GitHub remotes: fall back to "origin" (for now)
   // If no GitHub remotes: error
   ```

2. **Update CLI** to call this resolution function

3. **Ensure** the remote is still validated to be a GitHub remote; error if not.

---

## Phase 5: Add Interactive Remote Selection Component

**Goal**: When multiple GitHub remotes exist, prompt user to choose
**Can be merged**: Yes - final feature completion

### Changes:

1. **Create new Ink component** for remote selection:

   ```typescript
   // Similar to BookmarkSelectionComponent
   // Shows list of GitHub remotes with their URLs
   // Allows arrow key navigation and selection
   ```

2. **Update CLI** to use interactive selection when:

   - No --remote flag provided
   - Multiple GitHub remotes exist

3. **Update documentation** with examples of the new workflow

---

## File Impact Summary

- **Phase 1-2**: Mainly `jjUtils.ts` and `submit.ts`
- **Phase 3-4**: Mainly CLI files (`*.res` files)
- **Phase 5**: New Ink component + CLI integration
