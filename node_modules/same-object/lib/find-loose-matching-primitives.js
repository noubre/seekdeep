module.exports = function findLooseMatchingPrimitives (primitive) {
  switch (typeof primitive) {
    case 'undefined':
      return null
    case 'object':
      return undefined
    case 'symbol':
      return false
    case 'string':
      primitive = +primitive
      // Falls through
    case 'number':
      if (Number.isNaN(primitive)) {
        return false
      }
  }
  return true
}
