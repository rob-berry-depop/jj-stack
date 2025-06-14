#!/usr/bin/env node

import { getGitHubAuth, clearSavedAuth } from "./authUtils.js";

/**
 * Command to test GitHub authentication
 */
async function authTestCommand(): Promise<void> {
  try {
    console.log("🔐 Testing GitHub authentication...\n");

    const authConfig = await getGitHubAuth();

    console.log(`✅ Successfully authenticated via: ${authConfig.source}`);

    // Test the authentication by making a simple API call
    const { Octokit } = await import("octokit");
    const octokit = new Octokit({ auth: authConfig.token });

    const user = await octokit.rest.users.getAuthenticated();
    console.log(
      `👤 Authenticated as: ${user.data.login} (${user.data.name || "No name set"})`,
    );
    console.log(`📧 Email: ${user.data.email || "Not public"}`);

    // Check permissions
    console.log("\n🔍 Checking token permissions...");
    const response = await octokit.request("GET /user");
    const scopes = response.headers["x-oauth-scopes"]?.split(", ") || [];
    console.log(
      `📋 Token scopes: ${scopes.length > 0 ? scopes.join(", ") : "None detected"}`,
    );

    if (scopes.includes("repo")) {
      console.log("✅ Token has repo access (required for creating PRs)");
    } else {
      console.log(
        "⚠️  Token may not have sufficient permissions for creating PRs",
      );
    }
  } catch (error) {
    console.error(
      "❌ Authentication failed:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

/**
 * Command to clear saved authentication
 */
async function authLogoutCommand(): Promise<void> {
  try {
    console.log("🔓 Clearing saved authentication...\n");
    await clearSavedAuth();
    console.log("✅ Authentication cleared successfully");
    console.log(
      "💡 Note: This only clears tokens saved by jj-stack. GitHub CLI auth is managed separately.",
    );
  } catch (error) {
    console.error(
      "❌ Failed to clear authentication:",
      error instanceof Error ? error.message : String(error),
    );
    process.exit(1);
  }
}

/**
 * Show authentication help
 */
function authHelpCommand(): void {
  console.log("🔐 GitHub Authentication Help");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(
    "jj-stack supports multiple authentication methods (in priority order):",
  );
  console.log("");
  console.log("1. 🛠️  GitHub CLI (recommended)");
  console.log("   Install: https://cli.github.com/");
  console.log("   Setup: gh auth login");
  console.log("");
  console.log("2. 🌍 Environment Variables");
  console.log("   export GITHUB_TOKEN=your_token_here");
  console.log("   export GH_TOKEN=your_token_here  # Alternative name");
  console.log("");
  console.log("3. 📁 Config File");
  console.log("   File: ~/.config/jj-stack/config.json");
  console.log('   Format: {"github": {"token": "your_token_here"}}');
  console.log("");
  console.log("4. 🔗 Personal Access Token");
  console.log("   Create at: https://github.com/settings/tokens/new");
  console.log("   Required scopes: repo, pull_requests");
  console.log("");
  console.log("Commands:");
  console.log("  jj-stack auth test    - Test current authentication");
  console.log("  jj-stack auth logout  - Clear saved authentication");
  console.log("  jj-stack auth help    - Show this help");
}

// Main CLI handler for auth commands
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] !== "auth") {
    console.error("Usage: node authCommand.js auth <test|logout|help>");
    process.exit(1);
  }

  const subcommand = args[1];

  switch (subcommand) {
    case "test":
      await authTestCommand();
      break;
    case "logout":
      await authLogoutCommand();
      break;
    case "help":
    default:
      authHelpCommand();
      break;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { authTestCommand, authLogoutCommand, authHelpCommand };
