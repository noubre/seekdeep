module.exports = function sameKeys (a, b, opts, memos) {
  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) return false

  for (let i = 0; i < aKeys.length; i++) {
    if (!Object.prototype.propertyIsEnumerable.call(b, aKeys[i])) return false
  }

  // + if strict, then check symbol properties: https://github.com/nodejs/node/blob/2adea16e394448c4c87b0639514f8babbeb7a080/lib/internal/util/comparisons.js#L290

  return true
}
