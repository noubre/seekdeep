# test-tmp

Get a fresh tmpdir for tests

```
npm install test-tmp
```

## Usage

``` js
const test = require('brittle')
const tmp = require('test-tmp')

test('my test', async function (t) {
  const dir = await tmp(t)
  console.log('fresh dir for this test', dir)
})
```

## License

MIT
