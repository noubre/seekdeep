# refcounter

Simple refcounter

```
npm install refcounter
```

## Usage

``` js
const RefCounter = require('refcounter')

const refs = new RefCounter()

refs.inc()
refs.dec()

refs.isIdle() // true is no refs
await refs.idle() // wait for no refs
```

## License

Apache-2.0
