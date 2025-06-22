# Remote Selection Implementation Plan

Support configurable Git remotes instead of hardcoded "origin" for GitHub operations, with CLI-based remote selection.

## Phase 1: Refactor Library to Accept Remote Parameter ✅ COMPLETED

**Goal**: Make the library flexible to accept any remote name, but keep CLI hardcoded to "origin"
**Can be merged**: Yes - no breaking changes, just internal refactoring

### Changes Implemented:

1. **`JjFunctions` interface** - No changes needed ✅

   - `pushBookmark(bookmarkName: string, remote: string)` already existed
   - `getGitRemoteList()` already existed
   - All necessary remote functionality was already in place

2. **Updated `getGitHubRepoInfo`** to accept remote name ✅:

   ```typescript
   export async function getGitHubRepoInfo(
     jj: JjFunctions,
     remoteName: string,
   ): Promise<{ owner: string; repo: string }>;
   ```

3. **Updated `getGitHubConfig`** to accept and pass remote name ✅:

   ```typescript
   export async function getGitHubConfig(
     jj: JjFunctions,
     remoteName: string,
   ): Promise<GitHubConfig>;
   ```

4. **Updated `SubmissionPlan`** to track which remote is being used ✅:

   ```typescript
   export interface SubmissionPlan {
     // ...existing fields...
     remoteName: string; // NEW - required field
   }
   ```

5. **Updated `createSubmissionPlan`** to accept remote parameter ✅:

   ```typescript
   export async function createSubmissionPlan(
     jj: JjFunctions,
     githubConfig: GitHubConfig,
     segments: NarrowedBookmarkSegment[],
     remoteName: string, // NEW parameter
     callbacks?: PlanCallbacks,
   ): Promise<SubmissionPlan>;
   ```

6. **Updated `executeSubmissionPlan`** to use remote from plan ✅:

   - All `pushBookmark` calls now use `plan.remoteName` instead of hardcoded "origin"

7. **Updated CLI (ReScript) bindings** ✅:
   - External function declarations updated to match new TypeScript signatures
   - `submissionPlan` type includes `remoteName: string` field
   - All function calls pass "origin" as remote parameter

### Implementation Notes:

- **Breaking changes were made** (as approved) - no backward compatibility maintained
- **Type safety enforced** throughout with required `remoteName` field
- **CLI behavior unchanged** for users - still uses "origin" by default
- **All tests pass** and build succeeds

---

## Phase 2: Add Remote Validation ✅ COMPLETED

**Goal**: Add utilities to validate remotes are GitHub remotes and handle edge cases
**Can be merged**: Yes - pure addition, no behavior changes yet

### Changes Implemented:

1. **Added remote validation utilities** in `jjUtils.ts` ✅:

   ```typescript
   export function isGitHubRemote(remoteUrl: string): boolean;
   export function filterGitHubRemotes(
     remotes: Array<{ name: string; url: string }>,
   ): Array<{ name: string; url: string }>;
   ```

2. **Added error handling** for invalid remotes in `getGitHubRepoInfo` ✅:
   - Function now validates that the specified remote is a GitHub remote before attempting to parse
   - Throws descriptive errors for non-GitHub remotes instead of generic parsing failures

### Implementation Notes:

- **GitHub URL detection** supports both HTTPS (`https://github.com/owner/repo.git`) and SSH (`git@github.com:owner/repo.git`) formats
- **GitHub subdomains** like `company.github.com` are considered valid GitHub remotes
- **Comprehensive test coverage** added for all validation utilities
- **No breaking changes** - pure addition of new utilities
- **All tests pass** and build succeeds

---

## Phase 3: Add CLI --remote Flag Support

**Goal**: Allow users to specify remote via command line flag
**Can be merged**: Yes - additive feature, backwards compatible

### Changes Implemented:

1. **Added global flag extraction helper** in CLI (ReScript) ✅:

   - Implemented `extractGlobalFlags`, which removes `--remote <name>` from the argument list and returns both the filtered args and the remote name (defaulting to `origin`).

2. **Updated CLI command dispatch** to use filtered args ✅:

   - After extracting global flags, the CLI checks if the first argument is a known command. If so, it dispatches as usual. If not, it runs the default (analyze) command, passing the remote.

3. **Updated submit and analyze commands** to accept and use the remote parameter ✅:

   - Both commands now receive the remote name and use it for all remote operations.

4. **Validation and error handling** for remotes in CLI ✅:

   - The CLI validates that the specified remote exists and is a GitHub remote, failing fast with a descriptive error if not.

5. **Updated help text and examples** to document the new flag ✅

### Implementation Notes:

- The implementation is intentionally simple and does not use a CLI parsing library yet, but is structured to make such a migration easy in the future.
- The `--remote` flag now works for all commands, including the default (no subcommand) case.
- All tests pass and build succeeds.

---

## Phase 4: Add Remote Auto-Detection Logic ✅ COMPLETED

**Goal**: Automatically use the only remote if there's exactly one GitHub remote
**Can be merged**: Yes - smart defaults, no breaking changes

### Changes Implemented:

1. **Added remote resolution function** in CLI (ReScript):

   - Implemented `resolveRemoteName` in `src/cli/cli.res`.
   - Logic:
     - If `--remote` is specified, use it (with validation).
     - If not specified and exactly one GitHub remote exists, use it automatically.
     - If multiple GitHub remotes exist, fall back to `origin` (for now; interactive selection is Phase 5).
     - If no GitHub remotes exist, error out with a clear message.
     - All remotes are validated to be GitHub remotes before use.

2. **Updated CLI command dispatch** to use the new resolution logic:

   - The CLI now always calls `resolveRemoteName` before running any command that needs a remote.
   - The remote list is now awaited (async) to match the actual implementation in TypeScript.
   - The CLI type definitions for `jjFunctions` were updated in `src/cli/JJTypes.res` to ensure all remote-related functions are properly typed as async (`promise<...>`), matching the JS implementation.

3. **Error handling and validation**:

   - All error messages for missing, invalid, or non-GitHub remotes are clear and user-friendly.
   - The CLI fails fast if the remote is not valid.

4. **AIDEV-NOTE anchors**:
   - Added and updated `AIDEV-NOTE` comments in the CLI for future maintainers and AI agents.

### Implementation Notes:

- The implementation is intentionally simple and does not use a CLI parsing library yet, but is structured to make such a migration easy in the future.
- The remote auto-detection logic is fully backwards compatible and does not break existing workflows.
- Only CLI files (`*.res`) and type definitions were changed for this phase.
- All tests pass and build succeeds.

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
