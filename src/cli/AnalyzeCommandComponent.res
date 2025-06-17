@module("process") external exit: int => unit = "exit"
module Text = {
  @module("ink") @react.component
  external make: (~children: React.element) => React.element = "Text"
}

@react.component
let make = (
  ~changeGraph: JJTypes.changeGraph,
  ~prStatusMap: Map.t<string, SubmitCommand.pullRequest>,
) => {
  let isDataActionable =
    changeGraph.bookmarks
    ->Map.values
    ->Array.fromIterator
    ->Array.some(bookmark =>
      !bookmark.hasRemote || !bookmark.isSynced || prStatusMap->Map.get(bookmark.name) == None
    )

  React.useEffect(() => {
    if !isDataActionable {
      exit(0)
    }
    None
  }, [])

  <Text> {React.string("Hello world!")} </Text>
}
