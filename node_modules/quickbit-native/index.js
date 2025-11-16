const binding = require('./binding')

exports.get = function get(field, bit) {
  const n = field.byteLength * 8

  if (bit < 0) bit += n
  if (bit < 0 || bit >= n) return false

  return binding.quickbit_napi_get(toBuffer(field), bit) !== 0
}

exports.set = function set(field, bit, value = true) {
  const n = field.byteLength * 8

  if (bit < 0) bit += n
  if (bit < 0 || bit >= n) return false

  return binding.quickbit_napi_set(toBuffer(field), bit, value ? 1 : 0) !== 0
}

exports.fill = function fill(
  field,
  value,
  start = 0,
  end = field.byteLength * 8
) {
  const n = field.byteLength * 8

  if (start < 0) start += n
  if (end < 0) end += n
  if (start < 0 || start >= field.byteLength * 8 || start >= end) return field

  binding.quickbit_napi_fill(toBuffer(field), value ? 1 : 0, start, end)
  return field
}

exports.clear = function clear(field, ...chunks) {
  binding.quickbit_napi_clear(toBuffer(field), chunks.map(toBufferChunk))
}

exports.findFirst = function findFirst(field, value, position = 0) {
  const n = field.byteLength * 8

  if (position < 0) position += n
  if (position < 0) position = 0
  if (position >= n) return -1

  return binding.quickbit_napi_find_first(
    toBuffer(field),
    value ? 1 : 0,
    position
  )
}

exports.findLast = function findLast(
  field,
  value,
  position = field.byteLength * 8 - 1
) {
  const n = field.byteLength * 8

  if (position < 0) position += n
  if (position < 0) return -1
  if (position >= n) position = n - 1

  return binding.quickbit_napi_find_last(
    toBuffer(field),
    value ? 1 : 0,
    position
  )
}

function toBuffer(field) {
  if (field.BYTES_PER_ELEMENT === 1) return field
  return new Uint8Array(field.buffer, field.byteOffset, field.byteLength)
}

function toBufferChunk(chunk) {
  return { field: toBuffer(chunk.field), offset: chunk.offset }
}

class Index {
  static from(fieldOrChunks, byteLength = -1) {
    if (Array.isArray(fieldOrChunks)) {
      return new SparseIndex(fieldOrChunks, byteLength)
    } else {
      return new DenseIndex(fieldOrChunks, byteLength)
    }
  }

  constructor(byteLength) {
    this._byteLength = byteLength
    this.handle = Buffer.allocUnsafe(binding.sizeof_quickbit_index_t)
  }

  get byteLength() {
    return this._byteLength
  }

  skipFirst(value, position = 0) {
    const n = this.byteLength * 8

    if (position < 0) position += n
    if (position < 0) position = 0
    if (position >= n) return n - 1

    return binding.quickbit_napi_skip_first(
      this.handle,
      this.byteLength,
      value ? 1 : 0,
      position
    )
  }

  skipLast(value, position = this.byteLength * 8 - 1) {
    const n = this.byteLength * 8

    if (position < 0) position += n
    if (position < 0) return 0
    if (position >= n) position = n - 1

    return binding.quickbit_napi_skip_last(
      this.handle,
      this.byteLength,
      value ? 1 : 0,
      position
    )
  }
}

exports.Index = Index

class DenseIndex extends Index {
  constructor(field, byteLength) {
    super(byteLength)
    this.field = field

    binding.quickbit_napi_index_init(this.handle, toBuffer(this.field))
  }

  get byteLength() {
    if (this._byteLength !== -1) return this._byteLength
    return this.field.byteLength
  }

  update(bit) {
    const n = this.byteLength * 8

    if (bit < 0) bit += n
    if (bit < 0 || bit >= n) return false

    return (
      binding.quickbit_napi_index_update(
        this.handle,
        toBuffer(this.field),
        bit
      ) !== 0
    )
  }
}

function selectChunk(chunks, offset) {
  for (let i = 0; i < chunks.length; i++) {
    const next = chunks[i]

    const start = next.offset
    const end = next.offset + next.field.byteLength

    if (offset >= start && offset + 16 <= end) {
      return next
    }
  }

  return null
}

class SparseIndex extends Index {
  constructor(chunks, byteLength) {
    super(byteLength)
    this.chunks = chunks

    binding.quickbit_napi_index_init_sparse(
      this.handle,
      this.chunks.map(toBufferChunk)
    )
  }

  get byteLength() {
    if (this._byteLength !== -1) return this._byteLength
    const last = this.chunks[this.chunks.length - 1]
    return last ? last.offset + last.field.byteLength : 0
  }

  update(bit) {
    const n = this.byteLength * 8

    if (bit < 0) bit += n
    if (bit < 0 || bit >= n) return false

    const j = Math.floor(bit / 128)

    const offset = j * 16

    const chunk = selectChunk(this.chunks, offset)

    if (chunk === null) return false

    return (
      binding.quickbit_napi_index_update_sparse(
        this.handle,
        toBuffer(chunk.field),
        chunk.offset,
        bit
      ) !== 0
    )
  }
}
