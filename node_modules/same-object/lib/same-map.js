const same = require('../index.js')
const isPrimitive = require('./is-primitive.js')
const findLooseMatchingPrimitives = require('./find-loose-matching-primitives.js')

module.exports = function sameMap (a, b, opts, memos) {
  if (a.size !== b.size) return false

  const set = new Set()

  for (const [key, item1] of a) {
    if (!isPrimitive(key)) {
      set.add(key)
    } else {
      const item2 = b.get(key)
      if (((item2 === undefined && !b.has(key)) || !same(item1, item2, opts, memos))) {
        if (opts && opts.strict) return false

        // Discard string, symbol, undefined, and null keys
        if (!mapMightHaveLoosePrim(a, b, key, item1, memos)) return false

        set.add(key)
      }
    }
  }

  if (set.size > 0) {
    for (const [key, item] of b) {
      if (!isPrimitive(key)) {
        if (!mapHasEqualEntry(set, a, key, item, opts, memos)) {
          return false
        }
        continue
      }

      if (opts && opts.strict) continue

      if (a.has(key) && same(a.get(key), item, { strict: false }, memos)) continue

      if (mapHasEqualEntry(set, a, key, item, { strict: false }, memos)) continue

      return false
    }

    return set.size === 0
  }

  return true
}

function mapHasEqualEntry (set, a, key, bValue, opts, memos) {
  for (const key2 of set) {
    if (same(key, key2, opts, memos) && same(bValue, a.get(key2), opts, memos)) {
      set.delete(key2)
      return true
    }
  }

  return false
}

function mapMightHaveLoosePrim (a, b, primitive, item, memos) {
  const altValue = findLooseMatchingPrimitives(primitive)
  if (altValue != null) return altValue

  const bValue = b.get(altValue)
  if (bValue === undefined && !b.has(altValue)) return false
  if (!same(item, bValue, { strict: false }, memos)) return false

  return !a.has(altValue) && same(item, bValue, { strict: false }, memos)
}
