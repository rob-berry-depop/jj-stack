@scope("process") @val external argv: array<string> = "argv"
@scope("process") @val external exit: int => unit = "exit"

type logEntry = {
  commitId: string,
  changeId: string,
  authorName: string,
  authorEmail: string,
  descriptionFirstLine: string,
  parents: array<string>,
  localBookmarks: array<string>,
  remoteBookmarks: array<string>,
  isCurrentWorkingCopy: bool,
}

type bookmark = {
  name: string,
  commitId: string,
  changeId: string,
}

type bookmarkSegment = {
  bookmark: bookmark,
  changes: array<logEntry>,
  baseCommit: string,
}

type branchStack = {
  segments: array<bookmarkSegment>,
  baseCommit: string,
}

type changeGraph = {
  bookmarks: array<bookmark>,
  stacks: array<branchStack>,
  segmentChanges: Map.t<string, array<logEntry>>,
}

@module("../lib/jjUtils.js") external getLogOutput: unit => promise<'a> = "getLogOutput"
@module("../lib/jjUtils.js")
external buildChangeGraph: unit => promise<changeGraph> = "buildChangeGraph"

let help = `🔧 jj-stack - Jujutsu Git workflow automation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

USAGE:
  jj-stack [COMMAND] [OPTIONS]

COMMANDS:
  analyze               Analyze the current change graph

  submit <bookmark>     Submit a bookmark (and its stack) as PRs
    --dry-run           Show what would be done without making changes

  auth test             Test GitHub authentication
  auth logout           Clear saved authentication
  auth help             Show authentication help

  help, --help, -h      Show this help message

DEFAULT BEHAVIOR:
  Running jj-stack without arguments shows the current change graph

EXAMPLES:
  jj-stack                        # Show change graph
  jj-stack submit feature-branch  # Submit feature-branch as PR
  jj-stack submit feature-branch --dry-run  # Preview what would be done
  jj-stack auth test              # Test GitHub authentication

For more information, visit: https://github.com/your-org/jj-stack
`

@genType
let greet = name => {
  Console.log("Hello, " ++ name ++ "!")
}

@genType
let main = async () => {
  try {
    let args = Array.slice(argv, ~start=2, ~end=Array.length(argv))
    let command = args[0]
    switch command {
    | Some("auth") =>
      switch args[1] {
      | Some("test") => await AuthCommand.authTestCommand()
      | Some("logout") => await AuthCommand.authLogoutCommand()
      | _ => AuthCommand.authHelpCommand()
      }
    | Some("submit") =>
      switch args[1] {
      | Some(bookmarkName) => {
          let isDryRun = args->Array.includes("--dry-run")
          await SubmitCommand.submitCommand(bookmarkName, ~options={dryRun: isDryRun})
        }
      | None => {
          Console.error("Usage: jj-stack submit <bookmark-name> [--dry-run]")
          exit(1)
        }
      }
    | Some("analyze") => {
        Console.log("Building change graph from user bookmarks...")
        let changeGraph = await buildChangeGraph()

        Console.log("\n=== CHANGE GRAPH RESULTS ===")
        Console.log(`Total bookmarks: ${changeGraph.bookmarks->Array.length->Belt.Int.toString}`)
        Console.log(`Total stacks: ${changeGraph.stacks->Array.length->Belt.Int.toString}`)

        if changeGraph.stacks->Array.length > 0 {
          Console.log("\n=== BOOKMARK STACKS ===")
          changeGraph.stacks->Array.forEachWithIndex((stack, i) => {
            Console.log(`\nStack ${(i + 1)->Belt.Int.toString}:`)
            Console.log(`  Base commit: ${stack.baseCommit}`)
            Console.log(
              `  Bookmarks: ${stack.segments->Array.map(s => s.bookmark.name)->Array.join(", ")}`,
            )

            // Calculate total changes across all segments
            let totalChanges =
              stack.segments->Array.reduce(0, (sum, segment) => sum + segment.changes->Array.length)
            Console.log(`  Total changes: ${totalChanges->Belt.Int.toString}`)

            if stack.segments->Array.length > 1 {
              Console.log("  📚 This is a stacked set of bookmarks!")
            }
          })
        }

        Console.log("\n=== INDIVIDUAL BOOKMARK DETAILS ===")
        changeGraph.segmentChanges->Map.forEachWithKey((segmentChanges, bookmarkName) => {
          Console.log(`\n${bookmarkName}:`)
          Console.log(`  Segment changes: ${segmentChanges->Array.length->Belt.Int.toString}`)
          switch (segmentChanges->Array.at(0), segmentChanges->Array.last) {
          | (Some(first), Some(last)) => {
              Console.log(`  Latest: ${first.descriptionFirstLine}`)
              Console.log(`  Oldest: ${last.descriptionFirstLine}`)
            }
          | _ => ()
          }
        })
      }
    | Some("help") | Some("--help") | Some("-h") => Console.log(help)
    | Some(unknownCommand) => {
        Console.error(
          `Unknown command: ${unknownCommand}. Use 'jj-stack help' for usage information.`,
        )
        exit(1)
      }
    | _ => Console.log(help)
    }
  } catch {
  | Exn.Error(error) =>
    switch Exn.message(error) {
    | Some(message) => {
        Console.error("An error occurred: " ++ message)
        exit(1)
      }
    | None => {
        Console.error("An unknown error occurred.")
        exit(1)
      }
    }
  | _ => {
      Console.error("An unknown error occurred.")
      exit(1)
    }
  }
}
