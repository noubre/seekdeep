const test = require('brittle')
const sameObject = require('./')
const deepEqual = require('deep-equal')

test.configure({ bail: true })

// NOTE: most tests were copied and adapted from deep-equal library

const safeBuffer = typeof Buffer === 'function' ? Buffer.from : null
const buffersAreTypedArrays = typeof Buffer === 'function' && safeBuffer('') instanceof Uint8Array

test('basic', function (t) {
  t.ok(sameObject(1, '1'))
  t.absent(sameObject(1, '1', { strict: true }))
})

test('basic helper', function (t) {
  unlike(t, 1, '1')
  alikeLoosely(t, 1, '1')
})

test('equal', function (t) {
  alike(t,
    { a: [2, 3], b: [4] },
    { a: [2, 3], b: [4] },
    'two equal objects'
  )

  alikeLoosely(t,
    { a: 2, b: '4' },
    { a: 2, b: 4 },
    'two loosely equal, strictly inequal objects'
  )

  unlikeLoosely(t,
    { a: 2, b: 4 },
    { a: 2, B: 4 },
    'two inequal objects'
  )

  alikeLoosely(t,
    '-000',
    false,
    '`false` and `"-000"`'
  )
})

test('Maps', function (t) {
  alike(t,
    new Map([['a', 1], ['b', 2]]),
    new Map([['b', 2], ['a', 1]]),
    'two equal Maps'
  )

  unlikeLoosely(t,
    new Map([['a', [1, 2]]]),
    new Map([['a', [2, 1]]]),
    'two Maps with inequal values on the same key'
  )

  unlikeLoosely(t,
    new Map([['a', 1]]),
    new Map([['b', 1]]),
    'two inequal Maps'
  )

  alike(t,
    new Map([[{}, 3], [{}, 2], [{}, 1]]),
    new Map([[{}, 1], [{}, 2], [{}, 3]]),
    'two equal Maps in different orders with object keys'
  )

  alikeLoosely(t,
    new Map([[undefined, undefined]]),
    new Map([[undefined, null]]),
    'undefined keys, nullish values, loosely equal, strictly inequal'
  )

  alike(t,
    new Map([[{}, null], [true, 2], [{}, 1], [undefined, {}]]),
    new Map([[{}, 1], [true, 2], [{}, null], [undefined, {}]]),
    'two equal Maps in different orders with primitive keys'
  )

  alike(t,
    new Map([[false, 3], [{}, 2], [{}, 1]]),
    new Map([[{}, 1], [{}, 2], [false, 3]]),
    'two equal Maps in different orders with a mix of keys'
  )

  alikeLoosely(t,
    new Map([[null, undefined]]),
    new Map([[null, null]]),
    'null keys, nullish values, loosely equal, strictly inequal'
  )

  alikeLoosely(t,
    new Map([[undefined, 3]]),
    new Map([[null, 3]]),
    'nullish keys, loosely equal, strictly inequal'
  )

  alike(t,
    new Map([[{}, null], [true, 2], [{}, 1], [undefined, {}]]),
    new Map([[{}, 1], [true, 2], [{}, null], [undefined, {}]]),
    'two equal Maps in different orders with primitive keys'
  )

  alike(t,
    new Map([[false, 3], [{}, 2], [{}, 1]]),
    new Map([[{}, 1], [{}, 2], [false, 3]]),
    'two equal Maps in different orders with a mix of keys'
  )

  unlikeLoosely(t,
    new Map(),
    new Map([[{}, 1]]),
    'two inequal Maps'
  )

  unlikeLoosely(t,
    new Map([[{}, null], [false, 3]]),
    new Map([[{}, null], [true, 2]]),
    'two inequal maps, same size, primitive key, start with object key'
  )

  unlikeLoosely(t,
    new Map([[false, 3], [{}, null]]),
    new Map([[true, 2], [{}, null]]),
    'two inequal maps, same size, primitive key, start with primitive key'
  )

  alikeLoosely(t,
    new Map([[undefined, null], ['+000', 2]]),
    new Map([[null, undefined], [false, '2']]),
    'primitive comparisons'
  )
})

// +
test('WeakMaps', function (t) {
  alike(t,
    new WeakMap([[Object, null], [Function, true]]),
    new WeakMap([[Function, true], [Object, null]]),
    'two equal WeakMaps'
  )

  alike(t,
    new WeakMap([[Object, null]]),
    new WeakMap([[Object, true]]),
    'two WeakMaps with inequal values on the same key'
  )

  alike(t,
    new WeakMap([[Object, null], [Function, true]]),
    new WeakMap([[Object, null]]),
    'two inequal WeakMaps'
  )
})

test('Sets', function (t) {
  alike(t,
    new Set(['a', 1, 'b', 2]),
    new Set(['b', 2, 'a', 1]),
    'two equal Sets'
  )

  unlikeLoosely(t,
    new Set(['a', 1]),
    new Set(['b', 1]),
    'two inequal Sets'
  )

  alike(t,
    new Set([{}, 1, {}, {}, 2]),
    new Set([{}, 1, {}, 2, {}]),
    'two equal Sets in different orders'
  )

  unlikeLoosely(t,
    new Set(),
    new Set([1]),
    'two inequally sized Sets'
  )

  alikeLoosely(t,
    new Set([{ a: 1 }, 2]),
    new Set(['2', { a: '1' }]),
    'two loosely equal, strictly inequal Sets'
  )

  unlikeLoosely(t,
    new Set([{ a: 1 }, 2]),
    new Set(['2', { a: 2 }]),
    'two inequal Sets'
  )

  alikeLoosely(t,
    new Set([null, '', 1, 5, 2, false]),
    new Set([undefined, 0, '5', true, '2', '-000']),
    'more primitive comparisons'
  )

  alike(t,
    new Set([1, 2]),
    new Set([2, 1]),
    'primitives in different keys'
  )

  alike(t,
    new Set([{ a: 1 }, { b: 2 }]),
    new Set([{ b: 2 }, { a: 1 }]),
    'object values in different keys'
  )

  alike(t,
    new Set([new Set([1, 2]), new Set([3, 4])]),
    new Set([new Set([4, 3]), new Set([2, 1])]),
    'Set of Sets, all in different keys'
  )

  unlikeLoosely(t,
    new Set([{ a: 1 }, 1]),
    new Set([{ a: 1 }, 2]),
    'non primitive first, and non alike primitive later'
  )

  alikeLoosely(t,
    new Set([{ a: 1 }, Infinity]),
    new Set([{ a: 1 }, Infinity]),
    'primitive that is not loose'
  )

  unlikeLoosely(t,
    new Set([Symbol.for('hi')]),
    new Set([Symbol.for('hi2')]),
    'different symbols in a Set'
  )
})

test('Set and Map', function (t) {
  unlikeLoosely(t,
    new Set(),
    new Map(),
    'Map and Set'
  )

  // +
  /* const maplikeSet = new Set()
  Object.defineProperty(maplikeSet, 'constructor', { enumerable: false, value: Map })
  maplikeSet.__proto__ = Map.prototype // eslint-disable-line no-proto
  unlikeLoosely(t,
    maplikeSet,
    new Map(),
    'Map-like Set, and Map'
  ) */
})

// +
test('WeakSets', function (t) {
  alike(t,
    new WeakSet([Object, Function]),
    new WeakSet([Function, Object]),
    'two equal WeakSets'
  )

  alike(t,
    new WeakSet([Object, Function]),
    new WeakSet([Object]),
    'two inequal WeakSets'
  )
})

test('not equal', function (t) {
  unlikeLoosely(t,
    { x: 5, y: [6] },
    { x: 5, y: 6 },
    'two inequal objects are'
  )
})

test('nested nulls', function (t) {
  alike(t,
    [null, null, null],
    [null, null, null],
    'same-length arrays of nulls'
  )
})

test('objects with strings vs numbers', function (t) {
  alikeLoosely(t,
    [{ a: 3 }, { b: 4 }],
    [{ a: '3' }, { b: '4' }],
    'objects with equivalent string/number values'
  )
})

test('non-objects', function (t) {
  alike(t, 3, 3, 'same numbers', true, true, true)
  alike(t, 'beep', 'beep', 'same strings', true, true, true)
  alikeLoosely(t, '3', 3, 'numeric string and number', true, false)
  unlikeLoosely(t, '3', [3], 'numeric string and array containing number', false, false)
  unlikeLoosely(t, 3, [3], 'number and array containing number', false, false)
})

test('infinities', function (t) {
  alike(t, Infinity, Infinity, '∞ and ∞', true, true, true)
  alike(t, -Infinity, -Infinity, '-∞ and -∞', true, true, true)
  unlikeLoosely(t, Infinity, -Infinity, '∞ and -∞', false, false)
})

test('arguments class', function (t) {
  function getArgs () {
    return arguments
  }

  alike(t,
    getArgs(1, 2, 3),
    getArgs(1, 2, 3),
    'equivalent arguments objects are equal'
  )

  unlikeLoosely(t,
    getArgs(1, 2, 3),
    [1, 2, 3],
    'array and arguments with same contents'
  )

  const args = getArgs()
  const notArgs = tag({ length: 0 }, 'Arguments')
  unlikeLoosely(t,
    args,
    notArgs,
    'args and similar arraylike object'
  )
})

test('Dates', function (t) {
  const d0 = new Date(1387585278000)
  const d1 = new Date('Fri Dec 20 2013 16:21:18 GMT-0800 (PST)')

  alike(t, d0, d1, 'two Dates with the same timestamp', true, true)

  d1.a = true

  unlikeLoosely(t, d0, d1, 'two Dates with the same timestamp but different own properties', false, false)

  t.test('overriding `getTime`', function (st) {
    const a = new Date('2000')
    const b = new Date('2000')
    Object.defineProperty(a, 'getTime', { value: function () { return 5 } })
    alike(st, a, b, 'two Dates with the same timestamp but one has overridden `getTime`', true, true)
  })

  // +
  /* t.test('fake Date', { skip: !hasDunderProto }, function (st) {
    const a = new Date(2000)
    const b = tag(Object.create(
      a.__proto__, // eslint-disable-line no-proto
      Object.getOwnPropertyDescriptors(a)
    ), 'Date')

    unlikeLoosely(st,
      a,
      b,
      'Date, and fake Date'
    )
  }) */

  const a = new Date('2000')
  const b = new Date('2000')
  b.foo = true
  unlikeLoosely(t,
    a,
    b,
    'two identical Dates, one with an extra property'
  )

  unlikeLoosely(t,
    new Date('2000'),
    new Date('2001'),
    'two inequal Dates'
  )
})

test('buffers', { skip: typeof Buffer !== 'function' }, function (t) {
  alike(t,
    safeBuffer('xyz'),
    safeBuffer('xyz'),
    'buffers with same contents are equal'
  )

  unlikeLoosely(t,
    safeBuffer('xyz'),
    safeBuffer('xyy'),
    'buffers with same length and different contents are inequal'
  )

  unlikeLoosely(t,
    safeBuffer('xyz'),
    safeBuffer('xy'),
    'buffers with different length are inequal'
  )

  unlikeLoosely(t,
    safeBuffer('abc'),
    safeBuffer('xyz'),
    'buffers with different contents'
  )

  const emptyBuffer = safeBuffer('')

  unlikeLoosely(t,
    emptyBuffer,
    [],
    'empty buffer and empty array'
  )

  t.test('bufferlikes', function (st) {
    const fakeBuffer = {
      0: 'a',
      length: 1,
      __proto__: emptyBuffer.__proto__, // eslint-disable-line no-proto
      copy: emptyBuffer.copy,
      slice: emptyBuffer.slice
    }
    Object.defineProperty(fakeBuffer, '0', { enumerable: false })
    Object.defineProperty(fakeBuffer, 'length', { enumerable: false })
    Object.defineProperty(fakeBuffer, 'copy', { enumerable: false })
    Object.defineProperty(fakeBuffer, 'slice', { enumerable: false })

    unlikeLoosely(st,
      safeBuffer('a'),
      fakeBuffer,
      'real buffer, and mildly fake buffer'
    )

    st.test('bufferlike', function (s2t) {
      const bufferlike = buffersAreTypedArrays ? new Uint8Array() : {}
      Object.defineProperty(bufferlike, 'length', {
        enumerable: false,
        value: bufferlike.length || 0
      })
      Object.defineProperty(bufferlike, 'copy', {
        enumerable: false,
        value: emptyBuffer.copy
      })
      bufferlike.__proto__ = emptyBuffer.__proto__ // eslint-disable-line no-proto

      alike(s2t,
        emptyBuffer,
        bufferlike,
        'empty buffer and empty bufferlike'
      )
      s2t.end()
    })

    st.end()
  })

  t.end()
})

test('DataView', function (t) {
  const view1 = new DataView(new ArrayBuffer(10))
  const view2 = new DataView(new ArrayBuffer(10))

  alike(t,
    view1,
    view2,
    'two equals DataViews'
  )

  view1[3] = 7

  unlike(t,
    view1,
    view2,
    'two inequal DataViews'
  )
})

test('Arrays', function (t) {
  const a = []
  const b = []
  b.foo = true

  unlikeLoosely(t,
    a,
    b,
    'two identical arrays, one with an extra property'
  )

  const c = [undefined, 'test']
  const d = []
  d[1] = 'test'
  unlikeLoosely(t, c, d, 'sparse array')

  const e = [undefined, 'test', undefined, undefined, 'test2', undefined]
  const f = []
  e[1] = 'test'
  e[4] = 'test2'
  unlikeLoosely(t, e, f, 'sparse array')

  const g = new Array(10)
  const h = new Array(10)
  g[2] = 'test'
  g[5] = 'test2'
  g[8] = 'test3'
  h[2] = 'test'
  h[5] = 'test2'
  h[8] = 'test3'
  alike(t, g, h, 'sparse array')

  t.end()
})

test('booleans', function (t) {
  alike(t,
    true,
    true,
    'trues'
  )

  alike(t,
    false,
    false,
    'falses'
  )

  unlikeLoosely(t,
    true,
    false,
    'true and false'
  )

  t.end()
})

test('booleans and arrays', function (t) {
  unlikeLoosely(t,
    true,
    [],
    'true and an empty array',
    false,
    false
  )
  unlikeLoosely(t,
    false,
    [],
    'false and an empty array'
  )
  t.end()
})

test('arrays initiated', function (t) {
  const a0 = [
    undefined,
    null,
    -1,
    0,
    1,
    false,
    true,
    undefined,
    '',
    'abc',
    null,
    undefined
  ]
  const a1 = [
    undefined,
    null,
    -1,
    0,
    1,
    false,
    true,
    undefined,
    '',
    'abc',
    null,
    undefined
  ]

  alike(t,
    a0,
    a1,
    'arrays with equal contents are equal'
  )
  t.end()
})

test('arrays assigned', function (t) {
  const a0 = [
    undefined,
    null,
    -1,
    0,
    1,
    false,
    true,
    undefined,
    '',
    'abc',
    null,
    undefined
  ]
  const a1 = []

  a1[0] = undefined
  a1[1] = null
  a1[2] = -1
  a1[3] = 0
  a1[4] = 1
  a1[5] = false
  a1[6] = true
  a1[7] = undefined
  a1[8] = ''
  a1[9] = 'abc'
  a1[10] = null
  a1[11] = undefined
  a1.length = 12

  alike(t, a0, a1, 'a literal array and an assigned array', true, true)
  t.end()
})

test('arrays push', function (t) {
  const a0 = [
    undefined,
    null,
    -1,
    0,
    1,
    false,
    true,
    undefined,
    '',
    'abc',
    null,
    undefined
  ]
  const a1 = []

  a1.push(undefined)
  a1.push(null)
  a1.push(-1)
  a1.push(0)
  a1.push(1)
  a1.push(false)
  a1.push(true)
  a1.push(undefined)
  a1.push('')
  a1.push('abc')
  a1.push(null)
  a1.push(undefined)
  a1.length = 12

  alike(t, a0, a1, 'a literal array and a pushed array', true, true)
  t.end()
})

test('null == undefined', function (t) {
  alikeLoosely(t, null, undefined, 'null and undefined', true, false)
  alikeLoosely(t, [null], [undefined], '[null] and [undefined]', true, false)

  t.end()
})

// node 14 changed `deepEqual` to make two NaNs loosely equal
test('NaNs', function (t) {
  alike(t,
    NaN,
    NaN,
    'two NaNs'
  )

  alike(t,
    { a: NaN },
    { a: NaN },
    'two equiv objects with a NaN value'
  )

  unlikeLoosely(t, NaN, 1, 'NaN and 1', false, false)

  t.end()
})

test('zeroes', function (t) {
  alikeLoosely(t, 0, -0, '0 and -0', true, false)
  unlike(t, 0, -0, '0 and -0', true, false)

  alikeLoosely(t, { a: 0 }, { a: -0 }, 'two objects with a same-keyed 0/-0 value', true, false)
  unlike(t, { a: 0 }, { a: -0 }, 'two objects with a same-keyed 0/-0 value', true, false)

  t.end()
})

test('Object.create', function (t) {
  const a = { a: 'A' }
  const b = Object.create(a)
  b.b = 'B'
  const c = Object.create(a)
  c.b = 'C'

  unlikeLoosely(t,
    b,
    c,
    'two objects with the same [[Prototype]] but a different own property'
  )

  t.end()
})

test('Object.create(null)', function (t) {
  alike(t,
    Object.create(null),
    Object.create(null),
    'two empty null objects'
  )

  alike(t,
    Object.create(null, { a: { value: 'b' } }),
    Object.create(null, { a: { value: 'b' } }),
    'two null objects with the same property pair'
  )

  t.end()
})

test('regexes vs dates', function (t) {
  const d = new Date(1387585278000)
  const r = /abc/

  unlikeLoosely(t, d, r, 'Date and RegExp', false, false)

  t.end()
})

test('regexp', function (t) {
  unlikeLoosely(t, /abc/, /xyz/, 'two different regexes', false, false)
  alike(t, /abc/, /abc/, 'two abc regexes', true, true, false)
  alike(t, /xyz/, /xyz/, 'two xyz regexes', true, true, false)
  unlike(t, /abc/i, /def/g, 'two xyz regexes')

  // +
  /* t.test('fake RegExp', function (st) {
    const a = /abc/g
    const b = tag(Object.create(
      a.__proto__, // eslint-disable-line no-proto
      Object.getOwnPropertyDescriptors(a)
    ), 'RegExp')

    unlikeLoosely(st,a, b, 'regex and fake regex', false, false)

    st.end()
  }) */

  const a = /abc/gi
  const b = /abc/gi
  b.foo = true
  unlikeLoosely(t,
    a,
    b,
    'two identical regexes, one with an extra property'
  )

  const c = /abc/g
  const d = /abc/i
  unlikeLoosely(t,
    c,
    d,
    'two regexes with the same source but different flags'
  )

  t.end()
})

test('object literals', function (t) {
  alikeLoosely(t,
    { prototype: 2 },
    { prototype: '2' },
    'two loosely equal, strictly inequal prototype properties'
  )

  t.end()
})

test('arrays and objects', function (t) {
  unlikeLoosely(t, [], {}, 'empty array and empty object', false, false)
  unlikeLoosely(t, [], { length: 0 }, 'empty array and empty arraylike object', false, false)
  unlikeLoosely(t, [1], { 0: 1 }, 'array and similar object', false, false)

  t.end()
})

test('functions', function (t) {
  function f () {}

  alike(t, f, f, 'a function and itself', true, true, true)
  alike(t, [f], [f], 'a function and itself in an array', true, true, true)

  unlikeLoosely(t, function () {}, function () {}, 'two distinct functions', false, false, true)
  unlikeLoosely(t, [function () {}], [function () {}], 'two distinct functions in an array', false, false, true)

  unlikeLoosely(t, f, {}, 'function and object', false, false, true)
  unlikeLoosely(t, [f], [{}], 'function and object in an array', false, false, true)

  t.end()
})

test('Errors', function (t) {
  alike(t, new Error('xyz'), new Error('xyz'), 'two errors of the same type with the same message', true, true, false)
  unlikeLoosely(t, new Error('xyz'), new TypeError('xyz'), 'two errors of different types with the same message', false, false)
  unlikeLoosely(t, new Error('xyz'), new Error('zyx'), 'two errors of the same type with a different message', false, false)

  // +
  /* t.test('errorlike', { skip: !Object.defineProperty }, function (st) {
    const err = new Error('foo')
    // TODO: add `__proto__` when brand check is available
    const errorlike = tag({ message: err.message, stack: err.stack, name: err.name, constructor: err.constructor }, 'Error')
    Object.defineProperty(errorlike, 'message', { enumerable: false })
    Object.defineProperty(errorlike, 'stack', { enumerable: false })
    Object.defineProperty(errorlike, 'name', { enumerable: false })
    Object.defineProperty(errorlike, 'constructor', { enumerable: false })
    st.absent(errorlike instanceof Error)
    st.ok(err instanceof Error)
    unlikeLoosely(st,
      err,
      errorlike,
      'error, and errorlike object'
    )

    st.end()
  }) */

  // +
  unlikeLoosely(t,
    new Error('a'),
    Object.assign(new Error('a'), { code: 10 }),
    'two otherwise equal errors with different own properties'
  )

  // +
  /* t.test('fake error', { skip: !process.env.ASSERT || !hasDunderProto }, function (st) {
    const a = tag({
      __proto__: null
    }, 'Error')
    const b = new RangeError('abc')
    b.__proto__ = null // eslint-disable-line no-proto

    unlikeLoosely(st,
      a,
      b,
      'null object faking as an Error, RangeError with null proto'
    )
    st.end()
  }) */

  t.end()
})

test('object and null', function (t) {
  unlikeLoosely(t,
    {},
    null,
    'null and an object'
  )

  t.end()
})

test('error = Object', function (t) {
  unlikeLoosely(t,
    new Error('a'),
    { message: 'a' }
  )

  t.end()
})

test('[[Prototypes]]', function (t) {
  function C () {}
  const instance = new C()
  delete instance.constructor

  alikeLoosely(t, {}, instance, 'two identical objects with different [[Prototypes]]', true, false)

  t.test('Dates with different prototypes', function (st) {
    const d1 = new Date(0)
    const d2 = new Date(0)

    alike(st, d1, d2, 'two dates with the same timestamp', true, true)

    const newProto = {
      __proto__: Date.prototype
    }
    d2.__proto__ = newProto // eslint-disable-line no-proto
    st.ok(d2 instanceof Date, 'd2 is still a Date instance after tweaking [[Prototype]]')

    alikeLoosely(st, d1, d2, 'two dates with the same timestamp and different [[Prototype]]', true, false)

    st.end()
  })

  t.end()
})

test('toStringTag', function (t) {
  const o1 = {}
  t.is(Object.prototype.toString.call(o1), '[object Object]', 'o1: Symbol.toStringTag works')

  const o2 = {}
  t.is(Object.prototype.toString.call(o2), '[object Object]', 'o2: original Symbol.toStringTag works')

  alike(t, o1, o2, 'two normal empty objects', true, true)

  o2[Symbol.toStringTag] = 'jifasnif'
  t.is(Object.prototype.toString.call(o2), '[object jifasnif]', 'o2: modified Symbol.toStringTag works')

  unlikeLoosely(t, o1, o2, 'two normal empty objects with different toStringTags', false, false)

  t.end()
})

test('boxed primitives', function (t) {
  unlikeLoosely(t, Object(false), false, 'boxed and primitive `false`', false, false)
  unlikeLoosely(t, Object(true), true, 'boxed and primitive `true`', false, false)
  unlikeLoosely(t, Object(3), 3, 'boxed and primitive `3`', false, false)
  unlikeLoosely(t, Object(NaN), NaN, 'boxed and primitive `NaN`', false, false)
  unlikeLoosely(t, Object(''), '', 'boxed and primitive `""`', false, false)
  unlikeLoosely(t, Object('str'), 'str', 'boxed and primitive `"str"`', false, false)

  t.test('symbol', function (st) {
    const s = Symbol('')
    unlikeLoosely(st, Object(s), s, 'boxed and primitive `Symbol()`', false, false)
    st.end()
  })

  t.test('bigint', function (st) {
    const hhgtg = BigInt(42)
    unlikeLoosely(st, Object(hhgtg), hhgtg, 'boxed and primitive `BigInt(42)`', false, false)
    st.end()
  })

  // +
  /* t.test('`valueOf` is called for boxed primitives', function (st) {
    const a = Object(5)
    a.valueOf = function () { throw new Error('failed') }
    const b = Object(5)
    b.valueOf = function () { throw new Error('failed') }

    unlikeLoosely(st, a, b, 'two boxed numbers with a thrower valueOf', false, false)

    st.end()
  }) */

  t.end()
})

test('getters', function (t) {
  const a = {}
  Object.defineProperty(a, 'a', { enumerable: true, get: function () { return 5 } })
  const b = {}
  Object.defineProperty(b, 'a', { enumerable: true, get: function () { return 6 } })

  unlikeLoosely(t, a, b, 'two objects with the same getter but producing different values', false, false)

  t.end()
})

test('fake arrays: extra keys will be tested', function (t) {
  const a = tag({
    __proto__: Array.prototype,
    0: 1,
    1: 1,
    2: 'broken',
    length: 2
  }, 'Array')

  if (Object.defineProperty) {
    Object.defineProperty(a, 'length', {
      enumerable: false
    })
  }

  unlikeLoosely(t, a, [1, 1], 'fake and real array with same contents and [[Prototype]]', false, false)

  const b = tag(/abc/, 'Array')
  b.__proto__ = Array.prototype // eslint-disable-line no-proto
  b.length = 3
  if (Object.defineProperty) {
    Object.defineProperty(b, 'length', {
      enumerable: false
    })
  }
  unlikeLoosely(t, b, ['a', 'b', 'c'], 'regex faking as array, and array', false, false)

  t.end()
})

test('circular references', function (t) {
  const b = {}
  b.b = b

  const c = {}
  c.b = c

  alike(t,
    b,
    c,
    'two self-referencing objects'
  )

  const d = {}
  d.a = 1
  d.b = d

  const e = {}
  e.a = 1
  e.b = e.a

  unlikeLoosely(t,
    d,
    e,
    'two deeply self-referencing objects'
  )

  t.end()
})

test('TypedArrays', function (t) {
  // +
  /* t.test('Buffer faked as Uint8Array', function (st) {
    const a = safeBuffer('test')
    const b = tag(Object.create(
      a.__proto__, // eslint-disable-line no-proto
      Object.assign(Object.getOwnPropertyDescriptors(a), {
        length: {
          enumerable: false,
          value: 4
        }
      })
    ), 'Uint8Array')

    unlikeLoosely(st,
      a,
      b,
      'Buffer and Uint8Array'
    )

    st.end()
  }) */

  // +
  /* t.test('one TypedArray faking as another', { skip: !hasDunderProto }, function (st) {
    const a = new Uint8Array(10)
    const b = tag(new Int8Array(10), 'Uint8Array')
    b.__proto__ = Uint8Array.prototype // eslint-disable-line no-proto

    unlikeLoosely(st,
      a,
      b,
      'Uint8Array, and Int8Array pretending to be a Uint8Array'
    )

    st.end()
  }) */

  t.test('ArrayBuffers', { skip: typeof ArrayBuffer !== 'function' }, function (st) {
    const buffer1 = new ArrayBuffer(8) // initial value of 0's
    const buffer2 = new ArrayBuffer(8) // initial value of 0's

    const view1 = new Int8Array(buffer1)
    const view2 = new Int8Array(buffer2)

    alike(st,
      view1,
      view2,
      'Int8Arrays of similar ArrayBuffers'
    )

    alike(st,
      buffer1,
      buffer2,
      'similar ArrayBuffers'
    )

    for (let i = 0; i < view1.byteLength; i += 1) {
      view1[i] = 9 // change all values to 9's
    }

    unlikeLoosely(st,
      view1,
      view2,
      'Int8Arrays of different ArrayBuffers'
    )

    unlikeLoosely(st,
      buffer1,
      buffer2,
      'different ArrayBuffers'
    )

    // node < 0.11 has a nonconfigurable own byteLength property
    t.test('lies about byteLength', { skip: !('byteLength' in ArrayBuffer.prototype) }, function (s2t) {
      const empty4 = new ArrayBuffer(4)
      const empty6 = new ArrayBuffer(6)
      Object.defineProperty(empty6, 'byteLength', { value: 4 })

      unlikeLoosely(s2t,
        empty4,
        empty6,
        'different-length ArrayBuffers, one lying'
      )
      s2t.end()
    })

    st.end()
  })

  t.test('SharedArrayBuffers', { skip: typeof SharedArrayBuffer !== 'function' }, function (st) {
    const buffer1 = new SharedArrayBuffer(8) // initial value of 0's
    const buffer2 = new SharedArrayBuffer(8) // initial value of 0's

    const view1 = new Int8Array(buffer1)
    const view2 = new Int8Array(buffer2)

    alike(st,
      view1,
      view2,
      'Int8Arrays of similar SharedArrayBuffers'
    )

    alike(st,
      buffer1,
      buffer2,
      'similar SharedArrayBuffers'
    )

    for (let i = 0; i < view1.byteLength; i += 1) {
      view1[i] = 9 // change all values to 9's
    }

    unlikeLoosely(st,
      view1,
      view2,
      'Int8Arrays of different SharedArrayBuffers'
    )

    // +
    /* unlikeLoosely(st,
      buffer1,
      buffer2,
      'different SharedArrayBuffers'
    ) */

    // +
    /* t.test('lies about byteLength', { skip: !('byteLength' in SharedArrayBuffer.prototype) }, function (s2t) {
      const empty4 = new SharedArrayBuffer(4)
      const empty6 = new SharedArrayBuffer(6)
      Object.defineProperty(empty6, 'byteLength', { value: 4 })

      unlikeLoosely(s2t,
        empty4,
        empty6,
        'different-length SharedArrayBuffers, one lying'
      )
      s2t.end()
    }) */

    st.end()
  })

  t.end()
})

test('String object', function (t) {
  alike(t,
    new String('hi'), // eslint-disable-line no-new-wrappers
    new String('hi'), // eslint-disable-line no-new-wrappers
    'two same String objects'
  )

  unlike(t,
    new String('hi'), // eslint-disable-line no-new-wrappers
    new String('hi2'), // eslint-disable-line no-new-wrappers
    'two different String objects'
  )
})

test('Number object', function (t) {
  alike(t,
    new Number(1), // eslint-disable-line no-new-wrappers
    new Number(1), // eslint-disable-line no-new-wrappers
    'two same Number objects'
  )

  t.absent(sameObject(
    new Number(1), // eslint-disable-line no-new-wrappers
    new Number(2) // eslint-disable-line no-new-wrappers
  ), 'two different Number objects')
})

test('Boolean object', function (t) {
  alike(t,
    new Boolean(true), // eslint-disable-line no-new-wrappers
    new Boolean(true), // eslint-disable-line no-new-wrappers
    'two same Boolean objects'
  )

  t.absent(sameObject(
    new Boolean(true), // eslint-disable-line no-new-wrappers
    new Boolean(false) // eslint-disable-line no-new-wrappers
  ), 'two different Boolean objects')
})

test('objects', function (t) {
  t.is(sameObject({ foo: 1 }, { foo: 1 }), true)
  t.is(sameObject({ foo: 1 }, { foo: 1, bar: true }), false)
  t.is(sameObject({ foo: 1, nested: { a: 1 } }, { foo: 1, nested: { a: 1 } }), true)
  t.is(sameObject([{ a: 1 }, { b: 1 }], [{ a: 1 }, { b: 1 }]), true)
})

test('typed arrays', function (t) {
  t.is(sameObject(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true)
  t.is(sameObject(new Uint8Array([1, 2, 1]), new Uint8Array([1, 2, 3])), false)
})

test('symbols', function (t) {
  alike(t, Symbol.for('hello'), Symbol.for('hello'), 'same symbol', true, true)
  unlike(t, Symbol.for('hello'), Symbol.for('holas'), 'diff symbol', false, true)

  alike(t, [Symbol.for('hello')], [Symbol.for('hello')], 'symbol inside object', true, true)
  alike(t, { sym: Symbol.for('hello') }, { sym: Symbol.for('hello') }, 'symbol inside object', true, true)

  unlike(t, { sym: Symbol.for('hello') }, { sym: Symbol.for('holas') }, 'diff symbol inside object', false, true)
})

test('numbers', function (t) {
  alike(t, BigInt('9007199254740991'), BigInt('9007199254740991'), 'BigInt', true, true)
  alike(t, Infinity, Infinity, 'Infinity', true, true)

  // Note: deep-equal library fails, but Node's assert version passes, so we follow Node standard
  t.ok(sameObject(NaN, NaN, { strict: true }), 'NaN (alike)')
  t.ok(sameObject(NaN, NaN, { strict: false }), 'NaN (alike loosely)')
})

// +
test.skip('symbol as key', function (t) {
  alike(t, { a: true, [Symbol.for('aa')]: true }, { a: true, [Symbol.for('aa')]: true })
  unlike(t, { a: true, [Symbol.for('aa')]: true }, { a: true, [Symbol.for('cc')]: true })
})

test('promises', function (t) {
  const promise = new Promise(noop)
  alike(t, promise, promise, 'two promises with same reference')

  // +
  /* alike(t,
    new Promise(noop),
    new Promise(noop),
    'two promises'
  )

  alike(t,
    Promise.resolve('hi'),
    Promise.resolve('hi'),
    'resolve with same primitive'
  )

  unlike(t,
    Promise.resolve('hi1'),
    Promise.resolve('hi2'),
    'resolve with different primitive'
  )

  alike(t,
    Promise.resolve({ a: 1 }),
    Promise.resolve({ a: 1 }),
    'resolve with same objects'
  )

  unlike(t,
    Promise.resolve({ a: 1 }),
    Promise.resolve({ a: 2 }),
    'resolve with different objects'
  ) */

  function noop (resolve, reject) {}
})

test('functions', function (t) {
  unlike(t, function () {}, function () {}, 'two different functions', true, true)

  const fn = function () {}
  alike(t, fn, fn, 'two same functions', true, true)
})

// + merge this case with the other one
test('circular references x2', function (t) {
  const obj = { root: null }
  obj.root = obj
  const obj2 = { root: null }
  obj2.root = obj2
  alike(t, obj, obj2)

  const obj3 = [{ root: null }]
  obj3.root = obj3
  const obj4 = [{ root: null }]
  obj4.root = obj4
  alike(t, obj3, obj4)

  const obj5 = { sub: { root: null, sub2: { obj2, obj3 } } }
  obj5.sub.root = obj5
  const obj6 = { sub: { root: null, sub2: { obj2, obj3 } } }
  obj6.sub.root = obj6
  alike(t, obj5, obj6)

  const obj7 = [{ root: null }]
  obj7[0].root = obj7
  const obj8 = [{ root: null }]
  obj8[0].root = obj8
  alike(t, obj7, obj8)

  const o = {}
  const obj9 = { a: o, b: o }
  const o2 = {}
  const obj10 = { a: o2, b: o2 }
  alike(t, obj9, obj10)

  const obj11 = [o, o]
  const obj12 = [o, o]
  alike(t, obj11, obj12)

  const obj13 = [o, obj, o]
  obj13.obj = obj
  const obj14 = [o, obj, o]
  obj14.obj = obj
  alike(t, obj13, obj14)
})

function alike (t, a, b, comment = '') {
  try {
    t.ok(deepEqual(a, b, { strict: true }), '[deep-equal normal] ' + comment)
    t.ok(deepEqual(b, a, { strict: true }), '[deep-equal reversed] ' + comment)
  } catch (error) {
    if (error.message === 'Cannot convert a Symbol value to a string') t.comment('alike => ' + error.message + ' [deep-equal] ' + comment)
    else throw error
  }

  t.ok(sameObject(a, b, { strict: true }), '[same-object normal] ' + comment)
  t.ok(sameObject(b, a, { strict: true }), '[same-object reversed] ' + comment)
}

function alikeLoosely (t, a, b, comment = '') { // eslint-disable-line no-unused-vars
  try {
    t.ok(deepEqual(a, b, { strict: false }), '[deep-equal normal] ' + comment)
    t.ok(deepEqual(b, a, { strict: false }), '[deep-equal reversed] ' + comment)
  } catch (error) {
    if (error.message === 'Cannot convert a Symbol value to a string') t.comment('alike loosely => ' + error.message + ' [deep-equal] ' + comment)
    else throw error
  }

  t.ok(sameObject(a, b, { strict: false }), '[same-object normal] ' + comment)
  t.ok(sameObject(b, a, { strict: false }), '[same-object reversed] ' + comment)
}

function unlike (t, a, b, comment = '') {
  try {
    t.absent(deepEqual(a, b, { strict: true }), '[deep-equal normal] ' + comment)
    t.absent(deepEqual(b, a, { strict: true }), '[deep-equal reversed] ' + comment)
  } catch (error) {
    if (error.message === 'Cannot convert a Symbol value to a string') t.comment('unlike => ' + error.message + ' [deep-equal] ' + comment)
    else throw error
  }

  t.absent(sameObject(a, b, { strict: true }), '[same-object normal] ' + comment)
  t.absent(sameObject(b, a, { strict: true }), '[same-object reversed] ' + comment)
}

function unlikeLoosely (t, a, b, comment = '') { // eslint-disable-line no-unused-vars
  try {
    t.absent(deepEqual(a, b, { strict: false }), '[deep-equal normal] ' + comment)
    t.absent(deepEqual(b, a, { strict: false }), '[deep-equal reversed] ' + comment)
  } catch (error) {
    if (error.message === 'Cannot convert a Symbol value to a string') t.comment('unlike loosely => ' + error.message + ' [deep-equal] ' + comment)
    else throw error
  }

  t.absent(sameObject(a, b, { strict: false }), '[same-object normal] ' + comment)
  t.absent(sameObject(b, a, { strict: false }), '[same-object reversed] ' + comment)
}

function tag (obj, value) {
  Object.defineProperty(obj, Symbol.toStringTag, { value })
  return obj
}
