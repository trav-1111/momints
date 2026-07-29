// Binary assets bundled via wrangler's `type = "Data"` rule.
declare module '*.jpg' {
  const data: ArrayBuffer
  export default data
}
