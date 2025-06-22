# GitHub Authentication in jj-stack

## Authentication Methods

### 1. GitHub CLI (Recommended) ⭐

If you already have GitHub CLI installed and authenticated, jj-stack will automatically use it:

```bash
# Install GitHub CLI (if not already installed)
brew install gh  # macOS
# or visit https://cli.github.com/

# Authenticate with GitHub
gh auth login

# That's it! jj-stack will automatically detect and use your GitHub CLI auth
jst submit my-feature-branch
```

### 2. Environment Variables

Set a GitHub token as an environment variable:

```bash
# Option 1: GITHUB_TOKEN
export GITHUB_TOKEN="ghp_your_token_here"

# Option 2: GH_TOKEN (alternative name)
export GH_TOKEN="ghp_your_token_here"

# Add to your shell profile (.bashrc, .zshrc, etc.) to persist
echo 'export GITHUB_TOKEN="ghp_your_token_here"' >> ~/.zshrc
```

## Creating a Personal Access Token

If you need to create a GitHub Personal Access Token:

1. Go to https://github.com/settings/tokens/new
2. Give it a descriptive name (e.g., "jj-stack CLI")
3. Set expiration (recommended: 90 days)
4. Select scopes:
   - ✅ `repo` (Full control of private repositories, includes pull requests)
5. Click "Generate token"
6. Copy the token immediately (you won't see it again!)

## Testing Authentication

You can test your authentication setup:

```bash
# Test current authentication
jst auth test

# Show authentication help
jst auth help
```

The `auth test` command will show:

- ✅ Your GitHub username and name
- 📧 Your email (if public)
- 📋 Token scopes and permissions
- ✅ Confirmation that you have repo access for creating PRs
