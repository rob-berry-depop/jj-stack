// AIDEV-NOTE: Simplified authentication system
// Only supports GitHub CLI and environment variables, no local storage of tokens
// This follows security best practices by not storing sensitive credentials locally

import { execFile } from "child_process";
import { promisify } from "util";
import { Octokit } from "octokit";

const execFileAsync = promisify(execFile);

export interface AuthConfig {
  token: string;
  source: "gh-cli" | "env-var";
}

/**
 * Check if GitHub CLI is available and authenticated
 */
async function getGitHubCLIAuth(): Promise<string | null> {
  try {
    // First check if gh CLI is available
    await execFileAsync("gh", ["--version"]);

    // Check if user is authenticated
    await execFileAsync("gh", ["auth", "status"]);

    // If we get here, user is authenticated. Get the token.
    const tokenResult = await execFileAsync("gh", ["auth", "token"]);
    const token = tokenResult.stdout.trim();

    if (token) {
      console.log("✅ Using GitHub CLI authentication");
      return token;
    }
  } catch {
    // GitHub CLI not available or not authenticated
    return null;
  }

  return null;
}

/**
 * Get token from environment variable
 */
function getEnvironmentToken(): string | null {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) {
    console.log("✅ Using GitHub token from environment variable");
    return token;
  }
  return null;
}

/**
 * Show authentication setup instructions
 */
function showAuthInstructions(): never {
  console.error("\n🔐 GitHub Authentication Required");
  console.error("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.error(
    "To create and manage pull requests, jj-stack needs access to GitHub.",
  );
  console.error("\nPlease set up authentication using one of these methods:");
  console.error("1. Install GitHub CLI and run: gh auth login");
  console.error("2. Set environment variable: export GITHUB_TOKEN=your_token");
  console.error(
    "   (Create a token at: https://github.com/settings/tokens/new)",
  );
  console.error("\nRequired token permissions:");
  console.error("• repo (Full control of private repositories)");
  console.error("• pull_requests (Create and update pull requests)");

  throw new Error(
    "GitHub authentication required. Please set up authentication and try again.",
  );
}

/**
 * Validate that a token works by making a test API call
 */
async function validateToken(token: string): Promise<boolean> {
  try {
    const octokit = new Octokit({ auth: token });

    // Test the token by getting user info
    await octokit.rest.users.getAuthenticated();
    return true;
  } catch {
    return false;
  }
}

export async function getAuthDetails(authConfig: AuthConfig) {
  const octokit = new Octokit({ auth: authConfig.token });
  const user = await octokit.rest.users.getAuthenticated();
  const response = await octokit.request("GET /user");
  const scopes = response.headers["x-oauth-scopes"]?.split(", ") || [];
  return {
    username: user.data.login,
    name: user.data.name,
    email: user.data.email,
    scopes,
  };
}

/**
 * Get GitHub authentication token using the following priority:
 * 1. GitHub CLI (if available and authenticated)
 * 2. Environment variables (GITHUB_TOKEN or GH_TOKEN)
 * 3. Show setup instructions and exit
 */
export async function getGitHubAuth(): Promise<AuthConfig> {
  // 1. Try GitHub CLI first
  const ghCliToken = await getGitHubCLIAuth();
  if (ghCliToken) {
    return { token: ghCliToken, source: "gh-cli" };
  }

  // 2. Try environment variables
  const envToken = getEnvironmentToken();
  if (envToken) {
    // Validate the token
    if (await validateToken(envToken)) {
      return { token: envToken, source: "env-var" };
    } else {
      console.warn("⚠️  GitHub token from environment variable is invalid");
    }
  }

  // 3. No valid authentication found - show instructions
  showAuthInstructions();
}
