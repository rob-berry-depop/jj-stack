// AIDEV-NOTE: Interactive UI component for remote selection when multiple GitHub remotes exist
// Shows list of GitHub remotes with their URLs and extracted repo info
// Allows user to navigate and select which remote to use

@module("process") external exit: int => unit = "exit"

module Text = InkBindings.Text

// AIDEV-NOTE: Internal state for tracking user selection and navigation
type selectionState = {
  // Index into the remotes array for currently focused remote
  focusedRemoteIndex: int,
}

/**
 * AIDEV-NOTE: Extract GitHub repo info from a remote URL for display purposes
 * Uses a simple regex approach since we already validated it's a GitHub remote
 */
let extractRepoInfo = (url: string): option<(string, string)> => {
  // Simple regex for GitHub URLs (both HTTPS and SSH)
  // HTTPS: https://github.com/owner/repo.git
  // SSH: git@github.com:owner/repo.git

  let httpsPattern = %re("/https:\/\/(?:[^\/]+\.)?github\.com\/([^\/]+)\/([^\/]+?)(?:\.git)?$/")
  let sshPattern = %re("/git@(?:[^:]+\.)?github\.com:([^\/]+)\/([^\/]+?)(?:\.git)?$/")

  let tryMatch = (pattern, url) => {
    switch Js.String.match_(pattern, url) {
    | Some(matches) =>
      switch (matches[1], matches[2]) {
      | (Some(Some(owner)), Some(Some(repo))) => Some((owner, repo))
      | _ => None
      }
    | None => None
    }
  }

  switch tryMatch(httpsPattern, url) {
  | Some(result) => Some(result)
  | None => tryMatch(sshPattern, url)
  }
}

@react.component
let make = (~remotes: array<JJTypes.gitRemote>, ~onComplete: string => unit) => {
  // AIDEV-NOTE: Initialize selection state
  let (selectionState, setSelectionState) = React.useState(() => {
    {focusedRemoteIndex: 0}
  })

  // AIDEV-NOTE: Handle keyboard navigation
  InkBindings.useInput((_, key) => {
    if key.return {
      // User pressed Enter - select the currently focused remote
      let selectedRemote = remotes[selectionState.focusedRemoteIndex]->Option.getExn
      onComplete(selectedRemote.name)
    } else if key.upArrow {
      // Move focus up (to previous remote)
      setSelectionState(state => {
        if state.focusedRemoteIndex > 0 {
          {focusedRemoteIndex: state.focusedRemoteIndex - 1}
        } else {
          state
        }
      })
    } else if key.downArrow {
      // Move focus down (to next remote)
      setSelectionState(state => {
        if state.focusedRemoteIndex < remotes->Array.length - 1 {
          {focusedRemoteIndex: state.focusedRemoteIndex + 1}
        } else {
          state
        }
      })
    }
    ()
  }, None)

  // AIDEV-NOTE: Render the remote selection interface
  <React.Fragment>
    <Text> {React.string("Multiple GitHub remotes found. Please select one:\n\n")} </Text>
    {React.array(
      remotes->Array.mapWithIndex((remote, remoteIndex) => {
        let isFocused = remoteIndex == selectionState.focusedRemoteIndex

        let focusIndicator = if isFocused {
          <Text color="red"> {React.string("▶ ")} </Text>
        } else {
          <Text> {React.string("  ")} </Text>
        }

        // Extract repo info for better UX
        let repoInfoDisplay = switch extractRepoInfo(remote.url) {
        | Some((owner, repo)) => <Text color="cyan"> {React.string(` (${owner}/${repo})`)} </Text>
        | None => <Text> {React.string("")} </Text>
        }

        let remoteName = if isFocused {
          <Text color="red" bold=true> {React.string(remote.name)} </Text>
        } else {
          <Text bold=true> {React.string(remote.name)} </Text>
        }

        let remoteUrl = if isFocused {
          <Text color="yellow"> {React.string(remote.url)} </Text>
        } else {
          <Text color="gray"> {React.string(remote.url)} </Text>
        }

        <Text key={remoteIndex->Int.toString}>
          {focusIndicator}
          {remoteName}
          {repoInfoDisplay}
          {React.string("\n")}
          <Text> {React.string("    ")} </Text>
          {remoteUrl}
          {React.string("\n")}
        </Text>
      }),
    )}
    <Text> {React.string("\nUse ↑↓ to navigate, Enter to select\n")} </Text>
  </React.Fragment>
}
