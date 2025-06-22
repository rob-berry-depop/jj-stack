type inkKey = {
  upArrow: bool,
  downArrow: bool,
  leftArrow: bool,
  rightArrow: bool,
  return: bool,
}

// AIDEV-NOTE: Ink render function returns an instance with cleanup methods
type inkInstance = {unmount: unit => unit}
@module("ink") external render: React.element => inkInstance = "render"

module Text = {
  @module("ink") @react.component
  external make: (
    ~children: React.element,
    ~color: string=?,
    ~underline: bool=?,
    ~bold: bool=?,
  ) => React.element = "Text"
}

type inkUseInputOptions = {isActive: bool}

@module("ink")
external useInput: ((string, inkKey) => unit, option<inkUseInputOptions>) => unit = "useInput"
