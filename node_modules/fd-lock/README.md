# fd-lock

Stateful file descriptor locks for JavaScript.

```
npm i fd-lock
```

## Usage

```js
const FDLock = require('fd-lock')

const lock = new FDLock(fd, { wait: true })
await lock.ready()

// Lock is now held

await lock.close()
```

## License

Apache-2.0
