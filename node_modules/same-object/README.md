# same-object

Determine if two objects are deeply equal

```
npm install same-object
```

Supports circular references, Maps, Symbols, etc.

Aims for ~99% compatibility with `deep-equal` or `assert.deepEqual` without requiring native dependencies.\
Useful for JavaScript runtimes without native Node modules like `util`, etc.

## Usage
``` js
const sameObject = require('same-object')

console.log(sameObject(1, '1')) // true
console.log(sameObject(1, '1', { strict: true })) // false

console.log(sameObject({ a: 1 }, { a: 1 })) // true
console.log(sameObject({ a: 1 }, { a: 1, b: 2 })) // false

console.log(sameObject(
  new Set(['a', 1, 'b', 2]),
  new Set(['b', 2, 'a', 1])
)) // true
```

## API

#### `const bool = sameObject(a, b, [options])`

Compares `a` and `b`, returning whether they are equal or not.

Available `options`:
```js
{
  strict: false
}
```

Loosely comparison (`==`) by default.\
Use `{ strict: true }` for a stronger equality check (`===`).

## References
The source code is based on:\
[node/comparisons.js](https://github.com/nodejs/node/blob/2adea16e394448c4c87b0639514f8babbeb7a080/lib/internal/util/comparisons.js)\
[inspect-js/node-deep-equal](https://github.com/inspect-js/node-deep-equal)\
[chaijs/deep-eql](https://github.com/chaijs/deep-eql)

## License
MIT
