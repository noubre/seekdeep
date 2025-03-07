# globbie
A simple directory glob matcher using picomatch

## Usage
```js
const Globbie = require('globbie')

const pattern = 'src/**/*.js'

const globbie = new Globbie(pattern)
await globbie.match() // => ['src/index.js', 'src/utils/index.js', ...]

const globbieSync = new Globbie(pattern, { sync: true })
globbie.match() // => ['src/index.js', 'src/utils/index.js', ...]
```

## Options
The following options are available to be set in the `options` object:
- `sync` (boolean, default: `false`): Whether to use async or sync methods when running match

## License
Apache-2.0
