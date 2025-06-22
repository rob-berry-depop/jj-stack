// AIDEV-NOTE: GitHub authentication command implementations
// Supports GitHub CLI and environment variables only (no persistence)
// Commands: test (validate auth), help (show instructions)

type source = [#"gh-cli" | #"env-var"]

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
@module("../lib/auth.js")
external getAuthDetails: authConfig => promise<authDetails> = "getAuthDetails"

let sourceToString = (source: source): string => {
  switch source {
  | #"gh-cli" => "GitHub CLI"
  | #"env-var" => "Environment Variable"
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

let authHelpCommand = () => {
  Console.log(`🔐 GitHub Authentication Help
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
jj-stack supports the following authentication methods (in priority order):

1. 🛠️  GitHub CLI (recommended)
   Install: https://cli.github.com/
   Setup: gh auth login

2. 🌍 Environment Variables
   export GITHUB_TOKEN=your_token_here
   export GH_TOKEN=your_token_here  # Alternative name
   
   Create a Personal Access Token at: https://github.com/settings/tokens/new
   Required scopes: repo, pull_requests

Commands:
  jj-stack auth test - Test current authentication
  jj-stack auth help - Show this help

Note: jj-stack no longer stores tokens locally for security reasons.
Use GitHub CLI or environment variables for authentication.
`)
}
