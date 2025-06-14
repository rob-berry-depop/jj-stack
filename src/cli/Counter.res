module Text = {
  @module("ink") @react.component
  external make: (~children: React.element) => React.element = "Text"
}

@react.component
let make = () => {
  let (counter, setCounter) = React.useState(() => 0)
  React.useEffect(() => {
    let timer = Js.Global.setInterval(() => {
      setCounter(counter => counter + 1)
    }, 100)

    Some(() => Js.Global.clearInterval(timer))
  }, [counter])

  <Text> {React.string(counter->Belt.Int.toString)} </Text>
}
