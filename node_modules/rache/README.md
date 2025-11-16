# Rache

A random-eviction cache which imposes a global cache-size limit on all the caches derived from it.

Useful when you have many caches and want to limit their memory usage as a whole, instead of per cache.

The `get` and `set` operations as well as `delete` (and cache eviction) take constant time.

## Install

```
npm i rache
```

## Usage

```
const Rache = require('rache')

const cache = new Rache({ maxSize: 3 })
const cache2 = cache.sub()
const cache3 = cache.sub()

cache.set('key', 'value')
cache2.set('key', 'otherValue')
cache3.set('some', 'thing')

// cache 1 is a separate cache from cache2 and cache3
console.log('cached:', cache.get('key')) // 'value'

// But they share the same global size
console.log(cache.globalSize, 'of', cache.maxSize) // 3 of 3

cache.set('key2', 'another value')
// The cache was full, so one of the existing 3 entries got evicted

console.log(cache.globalSize, 'of', cache.maxSize) // 3 of 3
```

## API

#### `const cache = new Rache({ maxSize=65536 })`

Create a new cache.

`maxSize` is the maximum amount of entries globally, across this cache and all derived caches (derived with `cache.sub()` or `Rache.from(cache)`).

#### `const subCache = cache.sub()`

Create a new cache which shares the global memory limit with the original cache.

#### `const aCache = Rache.from(cache?)`

Create a new rache instance.

If an existing cache is passed in, it will create a sub-cache (equivalent to `aCache = cache.sub()`).

Otherwise (if no `cache` or a falsy value is passed in), it will create a new cache (equivalent to `aCache = new Rache()`).


#### `cache.globalSize`

The current amount of entries across all caches.

#### `cache.maxSize`

The maximum amount of entries across all caches.

#### `cache.size`

The amount of entries in this specific cache.

#### `cache.set(key, value)`

Set the key to the given value.

If the global cache size was at the limit, a random old entry is evicted from the cache.

#### `cache.delete(key)`

Delete the entry corresponding to `key`, if any.

Returns `true` if an entry was deleted, `false` otherwise.

#### `cache.get(key)`

Returns the value corresponding to the given key, or `undefined` if there is none.

#### `cache.keys()`

Returns an iterator over the keys of this particular cache.

#### `cache.values()`

Returns an iterator over the values of this particular cache.

#### `cache.clear()`

Clear all entries from this particular cache.

After clearing, new entries can again be added to the cache.

#### `cache.destroy()`

Destroys the cache. The cache should no longer be used after it has been destroyed.
