# GitHub Authentication in jj-stack

This document explains how jj-stack handles GitHub authentication in a user-friendly way.

## Authentication Methods (Priority Order)

### 1. GitHub CLI (Recommended) ⭐

If you already have GitHub CLI installed and authenticated, jj-stack will automatically use it:

```bash
# Install GitHub CLI (if not already installed)
brew install gh  # macOS
# or visit https://cli.github.com/

# Authenticate with GitHub
gh auth login

# That's it! jj-stack will automatically detect and use your GitHub CLI auth
jj-stack submit my-feature-branch
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

### 3. Config File

jj-stack can store your token in a config file:

```bash
# Create config directory
mkdir -p ~/.config/jj-stack

# Create config file
cat > ~/.config/jj-stack/config.json << EOF
{
  "github": {
    "token": "ghp_your_token_here"
  }
}
EOF
```

### 4. Manual Entry (Last Resort)

If none of the above methods are available, jj-stack will provide instructions for setting up authentication.

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
jj-stack auth test

# Clear saved authentication
jj-stack auth logout

# Show authentication help
jj-stack auth help
```

## Benefits of This Approach

1. **Zero Setup for GitHub CLI Users**: If you already use `gh`, it just works
2. **Flexible**: Multiple fallback options ensure it works in different environments
3. **Secure**: Leverages existing secure auth mechanisms when possible
4. **User Friendly**: Clear instructions when manual setup is needed
5. **Persistent**: Saves tokens securely for future use (with permission)

## Security Considerations

- GitHub CLI manages tokens securely in the system keychain
- Environment variables are only visible to your shell session
- Config files are stored in user-only readable directories
- Tokens are validated before use
- Invalid tokens are automatically removed from config

## Common Scenarios

### Developer Workstation

```bash
# Most developers already have this
gh auth login
jj-stack submit feature-branch  # ✅ Just works
```

### CI/CD Pipeline

```bash
# Use environment variable in CI
export GITHUB_TOKEN="${{ secrets.GITHUB_TOKEN }}"
jj-stack submit feature-branch
```

### Server/Script Environment

```bash
# Use config file for automated scripts
echo '{"github":{"token":"ghp_..."}}' > ~/.config/jj-stack/config.json
jj-stack submit feature-branch
```

This authentication system provides a smooth experience for users while maintaining security and flexibility across different environments.
