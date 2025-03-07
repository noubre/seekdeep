const same = require('../index.js')

module.exports = function sameIterable (a, b, opts, memos) {
  if (a.length !== b.length) return false

  for (let i = 0; i < a.length; i++) {
    if (!same(a[i], b[i], opts, memos)) {
      return false
    }
  }

  return true
}
