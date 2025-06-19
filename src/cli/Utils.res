let sleep = (ms: int): Js.Promise.t<unit> =>
  Js.Promise.make((~resolve, ~reject as _) => {
    let _ = Js.Global.setTimeout(() => {
      resolve()
    }, ms)
  })

let changeIdToLogEntry = (changeGraph: JJTypes.changeGraph, changeId) => {
  let segment = changeGraph.bookmarkedChangeIdToSegment->Map.get(changeId)->Option.getExn
  segment[0]->Option.getExn
}
