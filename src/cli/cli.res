@module("../lib/jjUtils.js") external getLogOutput: () => promise<'a> = "getLogOutput"

let output = await getLogOutput()
Console.log(output)

Console.log("Hello, world!")

@genType
let greet = (name) => {
  Console.log("Hello, " ++ name ++ "!")
}