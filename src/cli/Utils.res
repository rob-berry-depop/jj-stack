let sleep = (ms: int): Js.Promise.t<unit> =>
  Js.Promise.make((~resolve, ~reject as _) => {
    let _ = Js.Global.setTimeout(() => {
      resolve()
    }, ms)
  })
