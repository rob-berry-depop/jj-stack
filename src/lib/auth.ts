import { execFile } from "child_process";
import { promisify } from "util";
import { readFile, writeFile, mkdir } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import { Octokit } from "octokit";

const execFileAsync = promisify(execFile);

export interface AuthConfig {
  token: string;
  source: "gh-cli" | "env-var" | "config-file" | "manual";
}

interface ConfigFile {
  github?: {
    token?: string;
  };
}

/**
 * Get the config directory for jj-stack
 */
function getConfigDir(): string {
  const homeDir = homedir();
  return join(homeDir, ".config", "jj-stack");
}

/**
 * Get the config file path
 */
function getConfigFilePath(): string {
  return join(getConfigDir(), "config.json");
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
 * Load config from file
 */
async function loadConfigFile(): Promise<ConfigFile | null> {
  try {
    const configPath = getConfigFilePath();
    if (!existsSync(configPath)) {
      return null;
    }

    const configContent = await readFile(configPath, "utf-8");
    return JSON.parse(configContent) as ConfigFile;
  } catch {
    return null;
  }
}

/**
 * Save config to file
 */
async function saveConfigFile(config: ConfigFile): Promise<void> {
  try {
    const configDir = getConfigDir();
    const configPath = getConfigFilePath();

    // Ensure config directory exists
    await mkdir(configDir, { recursive: true });

    await writeFile(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    console.warn("Failed to save config file:", error);
  }
}

/**
 * Get token from config file
 */
async function getConfigFileToken(): Promise<string | null> {
  try {
    const config = await loadConfigFile();
    if (config?.github?.token) {
      console.log("✅ Using GitHub token from config file");
      return config.github.token;
    }
  } catch {
    // Config file doesn't exist or is invalid
  }
  return null;
}

/**
 * Prompt user for token (simplified version - in real implementation you might want to use a proper prompt library)
 */
function promptForToken(): Promise<string | null> {
  console.log("\n🔐 GitHub Authentication Required");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(
    "To create and manage pull requests, jj-stack needs access to GitHub.",
  );
  console.log(
    "\nPlease create a Personal Access Token (PAT) with the following permissions:",
  );
  console.log("• repo (Full control of private repositories)");
  console.log("• pull_requests (Create and update pull requests)");
  console.log("\nCreate one at: https://github.com/settings/tokens/new");
  console.log("\nAlternatively, you can:");
  console.log("1. Install GitHub CLI and run: gh auth login");
  console.log("2. Set environment variable: export GITHUB_TOKEN=your_token");
  console.log("3. Add token to config file: ~/.config/jj-stack/config.json");

  // For now, just throw an error with instructions
  // In a real implementation, you'd use a library like 'prompts' or 'inquirer'
  throw new Error(
    "Please set up GitHub authentication using one of the methods above and try again.",
  );
}

/**
 * Save token to config file for future use
 */
async function saveTokenToConfig(token: string): Promise<void> {
  try {
    const existingConfig = (await loadConfigFile()) || {};
    existingConfig.github = existingConfig.github || {};
    existingConfig.github.token = token;

    await saveConfigFile(existingConfig);
    console.log("💾 Token saved to config file for future use");
  } catch (error) {
    console.warn("Failed to save token to config file:", error);
  }
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
 * 3. Config file (~/.config/jj-stack/config.json)
 * 4. Prompt user for manual entry
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

  // 3. Try config file
  const configToken = await getConfigFileToken();
  if (configToken) {
    // Validate the token
    if (await validateToken(configToken)) {
      return { token: configToken, source: "config-file" };
    } else {
      console.warn("⚠️  GitHub token from config file is invalid");
      // Remove invalid token from config
      try {
        const config = await loadConfigFile();
        if (config?.github?.token) {
          delete config.github.token;
          await saveConfigFile(config);
        }
      } catch {
        // Ignore error when cleaning up invalid token
      }
    }
  }

  // 4. Last resort: prompt user
  const manualToken = await promptForToken();
  if (manualToken && (await validateToken(manualToken))) {
    // Save for future use
    await saveTokenToConfig(manualToken);
    return { token: manualToken, source: "manual" };
  }

  throw new Error("Failed to obtain valid GitHub authentication");
}

/**
 * Clear saved authentication (useful for logout functionality)
 */
export async function clearSavedAuth(): Promise<void> {
  try {
    const config = await loadConfigFile();
    if (config?.github?.token) {
      delete config.github.token;
      await saveConfigFile(config);
      console.log("🗑️  Cleared saved GitHub token");
    }
  } catch (error) {
    console.warn("Failed to clear saved auth:", error);
  }
}
