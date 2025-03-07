const same = require('../index.js')

module.exports = function sameKeyValues (a, b, opts, memos, keys = null) {
  if (keys === null) keys = Object.keys(a)

  for (const key of keys) {
    if (!same(a[key], b[key], opts, memos)) return false
  }

  return true
}
