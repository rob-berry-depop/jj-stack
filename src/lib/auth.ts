// AIDEV-NOTE: Auth architecture after refactoring:
// - lib/auth.ts: Pure functions that return structured results, no console output, no instructions
// - CLI commands implement all user messaging directly in AuthCommand.res
// - Library functions (like submit.ts) use lib/auth.ts directly for silent operation
// - Debug logging available via logger.ts when DEBUG=true

// AIDEV-NOTE: Simplified authentication system
// Only supports GitHub CLI and environment variables, no local storage of tokens
// This follows security best practices by not storing sensitive credentials locally

import { execFile } from "child_process";
import { promisify } from "util";
import { Octokit } from "octokit";
import { logger } from "./logger.js";

const execFileAsync = promisify(execFile);

export interface AuthConfig {
  token: string;
  source: "gh-cli" | "env-var";
}

// AIDEV-NOTE: Result types for clean separation of auth logic from presentation
export interface AuthSuccess {
  kind: "success";
  config: AuthConfig;
}

export interface AuthFailure {
  kind: "failure";
  reason: "no-auth-found" | "invalid-token";
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
      logger.debug("Found GitHub CLI authentication");
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
    logger.debug("Found GitHub token in environment variable");
    return token;
  }
  return null;
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
 * 3. Return failure with instructions
 */
export async function getGitHubAuth(): Promise<AuthSuccess | AuthFailure> {
  // 1. Try GitHub CLI first
  const ghCliToken = await getGitHubCLIAuth();
  if (ghCliToken) {
    return {
      kind: "success",
      config: { token: ghCliToken, source: "gh-cli" },
    };
  }

  // 2. Try environment variables
  const envToken = getEnvironmentToken();
  if (envToken) {
    // Validate the token
    if (await validateToken(envToken)) {
      return {
        kind: "success",
        config: { token: envToken, source: "env-var" },
      };
    } else {
      logger.debug("GitHub token from environment variable is invalid");
      return {
        kind: "failure",
        reason: "invalid-token",
      };
    }
  }

  // 3. No valid authentication found
  return {
    kind: "failure",
    reason: "no-auth-found",
  };
}
