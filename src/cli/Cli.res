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
@module("../lib/jjUtils.js")
external isGitHubRemote: string => bool = "isGitHubRemote"

let help = `🔧 jj-stack - Jujutsu Git workflow automation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

USAGE:
  jj-stack [COMMAND] [OPTIONS]

COMMANDS:
  submit <bookmark>     Submit a bookmark and all downstack bookmarks as PRs
    --dry-run           Show what would be done without making changes
    --remote <name>     Use the specified Git remote (must be a GitHub remote)

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
  jj-stack submit feature-branch --remote upstream  # Use a specific remote
  jj-stack auth test              # Test GitHub authentication

For more information, visit: https://github.com/keanemind/jj-stack
`

// AIDEV-NOTE: Extract global flags (e.g., --remote) and return filtered args and remoteName
let extractGlobalFlags = (args: array<string>): (array<string>, string) => {
  let idx = args->Array.findIndex(arg => arg == "--remote")
  if idx >= 0 && idx + 1 < Array.length(args) {
    let remoteName = args[idx + 1]->Belt.Option.getWithDefault("origin")
    let filteredArgs = Array.concat(
      Array.slice(args, ~start=0, ~end=idx),
      Array.slice(args, ~start=idx + 2, ~end=Array.length(args)),
    )
    (filteredArgs, remoteName)
  } else {
    (args, "origin")
  }
}

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
    let (filteredArgs, remoteName) = extractGlobalFlags(args)
    let knownCommands = ["submit", "auth", "help", "--help", "-h"]
    let command = filteredArgs[0]
    let isKnownCommand =
      command
      ->Belt.Option.map(cmd => knownCommands->Array.includes(cmd))
      ->Belt.Option.getWithDefault(false)
    switch command {
    | Some(cmd) if isKnownCommand =>
      switch cmd {
      | "auth" =>
        switch filteredArgs[1] {
        | Some("test") => await AuthCommand.authTestCommand()
        | _ => AuthCommand.authHelpCommand()
        }
      | "submit" =>
        switch filteredArgs[1] {
        | Some(bookmarkName) => {
            let isDryRun = filteredArgs->Array.includes("--dry-run")
            // Validate remote before proceeding
            let remotes = jjFunctions.getGitRemoteList()
            let foundRemote = remotes->Array.find(r => r.name == remoteName)
            switch foundRemote {
            | Some(remote) => {
                // Validate GitHub remote (URL check)
                if !isGitHubRemote(remote.url) {
                  Console.error(
                    `❌ Remote '${remoteName}' is not a GitHub remote. Only GitHub remotes are supported.`,
                  )
                  exit(1)
                }
                await SubmitCommand.submitCommand(
                  jjFunctions,
                  bookmarkName,
                  ~options={dryRun: isDryRun, remote: remoteName},
                )
              }
            | None => {
                Console.error(`❌ Remote '${remoteName}' does not exist.`)
                exit(1)
              }
            }
          }
        | None => {
            Console.error("Usage: jj-stack submit <bookmark-name> [--dry-run] [--remote <name>]")
            exit(1)
          }
        }
      | "help" | "--help" | "-h" => Console.log(help)
      | _ => () // Should not happen
      }
    | _ => await AnalyzeCommand.analyzeCommand(jjFunctions, ~remote=remoteName)
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
