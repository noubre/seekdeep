# bare-cov
Run tests with coverage

### Installation
```
npm i bare-cov
```

### Usage
```js
// Record coverage until current process ends and then generate reports
require('bare-cov')(options)
```

### Options
#### reporters
Coverage reporter(s) to use (default: `['text', 'json']`)

#### reporterOptions
Options to pass to each reporter keyed by reporter (default: `{}`)

#### dir
Directory to write coverage reports to (default: `coverage`)

#### skipRawDump
Skip saving of raw v8 coverage data to disk (default: `false`)

# License
Apache-2.0
