# DEVELOPMENT.md - jj-spice

## The Golden Rule

When unsure about implementation details, ALWAYS ask the developer.

## Project Context

jj-spice enables developers to create and manage stacked pull requests on GitHub while using the Jujutsu (JJ) version control system.

## Critical Architecture Decisions

### Why Jujutsu?

Jujutsu is a version control system built on top of Git. It has a simpler, more powerful model centered around a graph of _changes_, which maintain their identity even when moved around or rebased. Each _change_ has a history of _commits_ underneath it as the _change_ is updated over time.

### Key Jujutsu resources

CLI reference: https://jj-vcs.github.io/jj/latest/cli-reference/
Standard workflow: https://steveklabnik.github.io/jujutsu-tutorial/real-world-workflows/the-squash-workflow.html

## Code Style and Patterns

### Anchor comments

Add specially formatted comments throughout the codebase, where appropriate, for yourself as inline knowledge that can be easily `grep`ped for.

### Guidelines:

- Use `AIDEV-NOTE:`, `AIDEV-TODO:`, or `AIDEV-QUESTION:` (all-caps prefix) for comments aimed at AI and developers.
- **Important:** Before scanning files, always first try to **grep for existing anchors** `AIDEV-*` in relevant subdirectories.
- **Update relevant anchors** when modifying associated code.
- **Do not remove `AIDEV-NOTE`s** without explicit human instruction.
- Make sure to add relevant anchor comments, whenever a file or piece of code is:
  - too complex, or
  - very important, or
  - confusing, or
  - could have a bug

## What AI Must NEVER Do

1. **Never modify test files** - Tests encode human intent
2. **Never commit secrets** - Use environment variables
3. **Never assume business logic** - Always ask
4. **Never remove AIDEV- comments** - They're there for a reason

Remember: We optimize for maintainability over cleverness.  
When in doubt, choose the boring solution.

## Domain Glossary (AI, learn these!)

### Bookmark

A bookmark is a named pointer to a [commit](#commit). They are similar to Git's
[branches](#branch) and even more similar to [Mercurial's
bookmarks](https://wiki.mercurial-scm.org/Bookmarks). See [here](bookmarks.md)
for details.

Unlike in Git, there is no concept of a "current bookmark"; bookmarks _do not_
move when you create a new commit. Bookmarks _do_ automatically follow the
commit if it gets [rewritten](#rewrite).

### Branch

In the context of `jj`, the work "branch" usually refers to an [anonymous
branch](#anonymous-branch) or, less formally, a branch of the commit "tree"
(which is itself an informal way to refer to the commit graph, parts of which
might resemble a tree even when it's not mathematically a tree).

We also sometimes discuss Git's branches and branches on Git remotes. Locally,
these correspond to [bookmarks](#bookmark). In a co-located repository, each
local Git branch corresponds to a `jj` bookmark.

### Change

A change is a commit as it [evolves over time](#rewrite). Changes themselves
don't exist as an object in the data model; only the change ID does. The change
ID is a property of a commit.

### Change ID

A change ID is a unique identifier for a [change](#change). They are typically
16 bytes long and are often randomly generated. By default, `jj log` presents
them as a sequence of 12 letters in the k-z range, at the beginning of a line.
These are actually hexadecimal numbers that use "digits" z-k instead of 0-9a-f.

### Commit

A snapshot of the files in the repository at a given point in time (technically
a [tree object](#tree)), together with some metadata. The metadata includes the
author, the date, and pointers to the commit's parents. Through the pointers to
the parents, the commits form a
[Directed Acyclic Graph (DAG)](https://en.wikipedia.org/wiki/Directed_acyclic_graph)
.

Note that even though commits are stored as snapshots, they are often treated
as differences between snapshots, namely compared to their parent's snapshot. If
they have more than one parent, then the difference is computed against the
result of merging the parents. For example, `jj diff` will show the differences
introduced by a commit compared to its parent(s), and `jj rebase` will apply
those changes onto another base commit.

The word "revision" is used as a synonym for "commit".
