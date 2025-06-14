@module("../lib/jjUtils.js") external getLogOutput: unit => promise<'a> = "getLogOutput"
@scope("process") @val external argv: array<string> = "argv"
@scope("process") @val external exit: int => unit = "exit"

let help = `🔧 jj-stack - Jujutsu Git workflow automation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

USAGE:
  jj-stack [COMMAND] [OPTIONS]

COMMANDS:
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
    let output = await getLogOutput()
    Console.log(output)

    let args = Array.slice(argv, ~start=2, ~end=Array.length(argv))
    let command = args[0]
    switch command {
    | Some("auth") =>
      switch args[1] {
      | Some("test") => await AuthCommand.authTestCommand()
      | Some("logout") => await AuthCommand.authLogoutCommand()
      | _ => AuthCommand.authHelpCommand()
      }
    | Some("help") | Some("--help") | Some("-h") => Console.log(help)
    | Some(unknownCommand) =>
      Console.log(`Unknown command: ${unknownCommand}. Use 'jj-stack help' for usage information.`)
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
