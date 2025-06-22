// AIDEV-NOTE: GitHub authentication command implementations
// Supports multiple auth methods: GitHub CLI, env vars, config files, manual entry
// Commands: test (validate auth), logout (clear saved auth), help (show instructions)

type source = [#"gc-cli" | #"env-var" | #"config-file" | #manual]

type authConfig = {
  token: string,
  source: source,
}

type authDetails = {
  username: string,
  name: option<string>,
  email: option<string>,
  scopes: array<string>,
}

@module("../lib/auth.js") external getGitHubAuth: unit => promise<authConfig> = "getGitHubAuth"
@module("../lib/auth.js") external clearSavedAuth: unit => promise<unit> = "clearSavedAuth"
@module("../lib/auth.js")
external getAuthDetails: authConfig => promise<authDetails> = "getAuthDetails"

let sourceToString = (source: source): string => {
  switch source {
  | #"gc-cli" => "GitHub CLI"
  | #"env-var" => "Environment Variable"
  | #"config-file" => "Config File"
  | #manual => "Manual Entry"
  }
}

let authTestCommand = async () => {
  Console.log("🔐 Testing GitHub Authentication...\n")

  let authConfig = await getGitHubAuth()

  Console.log(`✅ Successfully authenticated via: ${authConfig.source->sourceToString}`)

  // Test the authentication by making a simple API call
  let authDetails = await getAuthDetails(authConfig)

  let nameStr = switch authDetails.name {
  | Some(name) => name
  | None => "No name set"
  }
  Console.log(`👤 Authenticated as: ${authDetails.username} (${nameStr})`)

  let emailStr = switch authDetails.email {
  | Some(email) => email
  | None => "Not public"
  }
  Console.log(`📧 Email: ${emailStr}`)

  let scopesStr =
    authDetails.scopes->Array.length > 0 ? authDetails.scopes->Array.join(", ") : "None detected"
  Console.log(`📋 Token scopes: ${scopesStr}`)

  if authDetails.scopes->Array.includes("repo") {
    Console.log("✅ Token has repo access (required for creating PRs)")
  } else {
    Console.log("⚠️  Token may not have sufficient permissions for creating PRs")
  }
}

let authLogoutCommand = async () => {
  Console.log("🔓 Clearing saved authentication...\n")
  await clearSavedAuth()
  Console.log("✅ Authentication cleared successfully")
  Console.log(
    "💡 Note: This only clears tokens saved by jj-stack. GitHub CLI auth is managed separately.",
  )
}

let authHelpCommand = () => {
  Console.log(`🔐 GitHub Authentication Help
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
jj-stack supports multiple authentication methods (in priority order):
1. 🛠️  GitHub CLI (recommended)
   Install: https://cli.github.com/
   Setup: gh auth login
2. 🌍 Environment Variables
   export GITHUB_TOKEN=your_token_here
   export GH_TOKEN=your_token_here  # Alternative name
3. 📁 Config File
   File: ~/.config/jj-stack/config.json
   Format: {"github": {"token": "your_token_here"}}
4. 🔗 Personal Access Token
   Create at: https://github.com/settings/tokens/new
   Required scopes: repo
Commands:
  jj-stack auth test    - Test current authentication
  jj-stack auth logout  - Clear saved authentication
  jj-stack auth help    - Show this help
`)
}
