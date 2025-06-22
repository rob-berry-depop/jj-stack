@scope("process") @val external argv: array<string> = "argv"
@scope("process") @val external exit: int => unit = "exit"

// AIDEV-NOTE: Main CLI entry point implementing all jj-stack commands:
// - Default (no args): Interactive change graph analysis and stack selection
// - submit <bookmark> [--dry-run]: Submit bookmark stack as PRs
// - auth test: Validate GitHub authentication setup
// - auth help: Show authentication setup instructions
// - help/--help/-h: Display command usage information

// AIDEV-NOTE: Central jjFunctions initialization for dependency injection pattern
@module("../lib/jjUtils.js")
external createJjFunctions: JJTypes.jjConfig => JJTypes.jjFunctions = "createJjFunctions"

let help = `🔧 jj-stack - Jujutsu Git workflow automation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

USAGE:
  jj-stack [COMMAND] [OPTIONS]

COMMANDS:
  submit <bookmark>     Submit a bookmark and all downstack bookmarks as PRs
    --dry-run           Show what would be done without making changes

  auth test             Test GitHub authentication
  auth help             Show authentication help

  help, --help, -h      Show this help message

DEFAULT BEHAVIOR:
  Running jj-stack without arguments analyzes and displays the current
  graph of stacked bookmarks.

EXAMPLES:
  jj-stack                        # Show change graph
  jj-stack submit feature-branch  # Submit feature-branch and downstack as PRs
  jj-stack submit feature-branch --dry-run  # Preview what would be done
  jj-stack auth test              # Test GitHub authentication

For more information, visit: https://github.com/keanemind/jj-stack
`

@genType
let main = async () => {
  try {
    // AIDEV-NOTE: Initialize JJ functions once during CLI startup for efficiency
    let jjPathResult = await Utils.getJJPath()
    let jjConfig: JJTypes.jjConfig = {
      binaryPath: jjPathResult.filepath,
    }
    let jjFunctions = createJjFunctions(jjConfig)

    let args = Array.slice(argv, ~start=2, ~end=Array.length(argv))
    let command = args[0]
    switch command {
    | Some("auth") =>
      switch args[1] {
      | Some("test") => await AuthCommand.authTestCommand()
      | _ => AuthCommand.authHelpCommand()
      }
    | Some("submit") =>
      switch args[1] {
      | Some(bookmarkName) => {
          let isDryRun = args->Array.includes("--dry-run")
          await SubmitCommand.submitCommand(jjFunctions, bookmarkName, ~options={dryRun: isDryRun})
        }
      | None => {
          Console.error("Usage: jj-stack submit <bookmark-name> [--dry-run]")
          exit(1)
        }
      }
    | Some("help") | Some("--help") | Some("-h") => Console.log(help)
    | Some(unknownCommand) => {
        Console.error(
          `Unknown command: ${unknownCommand}. Use 'jj-stack help' for usage information.`,
        )
        exit(1)
      }
    | _ => await AnalyzeCommand.analyzeCommand(jjFunctions)
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
