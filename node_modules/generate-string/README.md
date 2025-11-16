# generate-string

Generate a js string safely, that defaults to a single quoted string

```
npm install generate-string
```

## Usage

``` js
const generateString = require('generate-string')

console.log(generateString('42')) // '42'
console.log(generateString('"42')) // "\"42"
```

## License

MIT
