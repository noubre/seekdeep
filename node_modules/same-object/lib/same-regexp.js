module.exports = function sameRegExp (a, b) {
  return a.source === b.source && a.flags === b.flags
}
