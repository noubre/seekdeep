module.exports = same

const isPrimitive = require('./lib/is-primitive.js')
const sameKeys = require('./lib/same-keys.js')
const sameKeyValues = require('./lib/same-key-values.js')
const sameIterable = require('./lib/same-iterable.js')
const sameSet = require('./lib/same-set.js')
const sameMap = require('./lib/same-map.js')
const sameArray = require('./lib/same-array.js')
const sameRegExp = require('./lib/same-regexp.js')

function same (a, b, opts, memos) {
  // Short path optimization
  if (a === b) {
    if (a !== 0) return true
    return opts && opts.strict ? Object.is(a, b) : true
  }

  const aIsPrimitive = isPrimitive(a)
  const bIsPrimitive = isPrimitive(b)

  if (aIsPrimitive && bIsPrimitive) {
    if (opts && opts.strict) {
      return typeof a === 'number' ? (Number.isNaN(a) && Number.isNaN(b)) : a === b
    }
    return a == b || (Number.isNaN(a) && Number.isNaN(b)) // eslint-disable-line eqeqeq
  }

  if (aIsPrimitive !== bIsPrimitive) return false

  if (opts && opts.strict) {
    if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false
  }

  const aType = getType(a)
  const bType = getType(b)

  if (aType !== bType) return false

  if (!sameKeys(a, b, opts, memos)) return false

  switch (aType) {
    case 'String':
    case 'Number':
    case 'Boolean':
    case 'Date':
      return same(a.valueOf(), b.valueOf(), opts, memos)
  }

  if (aType === 'Error') {
    return sameKeyValues(a, b, opts, memos, ['name', 'message'])
  }

  switch (aType) {
    case 'Int8Array':
    case 'Uint8Array':
    case 'Uint8ClampedArray':
    case 'Int16Array':
    case 'Uint16Array':
    case 'Int32Array':
    case 'Uint32Array':
    case 'Float32Array':
    case 'Float64Array':
      return sameIterable(a, b, opts, memos)
    case 'DataView':
      return sameIterable(new Uint8Array(a.buffer, a.byteOffset, a.byteLength), new Uint8Array(b.buffer, b.byteOffset, b.byteLength), opts, memos)
    case 'ArrayBuffer':
      return sameIterable(new Uint8Array(a), new Uint8Array(b), opts, memos)
  }

  if (aType === 'RegExp') return sameRegExp(a, b)

  if (!memos) {
    memos = { a: new Map(), b: new Map(), position: 0 }
  } else {
    const memoA = memos.a.get(a)
    if (memoA !== undefined) {
      const memoB = memos.b.get(b)
      if (memoB !== undefined) return memoA === memoB
    }
    memos.position++
  }

  memos.a.set(a, memos.position)
  memos.b.set(b, memos.position)

  const equals = sameObject(a, b, opts, memos, aType)

  memos.a.delete(a)
  memos.b.delete(b)

  return equals
}

function sameObject (a, b, opts, memos, aType) {
  if (aType === 'Array' || aType === 'Arguments') {
    if (!sameArray(a, b, opts, memos)) return false
  }

  if (aType === 'Set') {
    if (!sameSet(a, b, opts, memos)) return false
  }

  if (aType === 'Map') {
    if (!sameMap(a, b, opts, memos)) return false
  }

  if (!sameKeyValues(a, b, opts, memos)) return false

  return true
}

function getType (o) {
  // Note: it returns 'Null' for null prototypes
  return Object.prototype.toString.call(o).slice(8, -1)
}
