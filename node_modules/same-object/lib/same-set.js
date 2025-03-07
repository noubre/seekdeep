const same = require('../index.js')
const isPrimitive = require('./is-primitive.js')
const findLooseMatchingPrimitives = require('./find-loose-matching-primitives.js')

module.exports = function sameSet (a, b, opts, memos) {
  if (a.size !== b.size) return false

  const set = new Set()

  for (const aValue of a) {
    if (!isPrimitive(aValue)) {
      // Non-null object (non strict only: a not matching primitive)
      set.add(aValue)
    } else if (!b.has(aValue)) {
      if (opts && opts.strict) return false

      // Discard string, symbol, undefined, and null values
      if (!setMightHaveLoosePrim(a, b, aValue)) return false

      set.add(aValue)
    }
  }

  if (set.size > 0) {
    for (const bValue of b) {
      if (!isPrimitive(bValue)) {
        if (!setHasEqualElement(set, bValue, opts, memos)) {
          return false
        }
        continue
      }

      if (opts && opts.strict) continue

      if (a.has(bValue)) continue

      if (setHasEqualElement(set, bValue, opts, memos)) continue

      return false
    }

    return set.size === 0
  }

  return true
}

function setMightHaveLoosePrim (a, b, primitive) {
  const altValue = findLooseMatchingPrimitives(primitive)
  if (altValue != null) return altValue

  return b.has(altValue) && !a.has(altValue)
}

function setHasEqualElement (set, val1, opts, memos) {
  for (const val2 of set) {
    if (same(val1, val2, opts, memos)) {
      set.delete(val2)
      return true
    }
  }

  return false
}
