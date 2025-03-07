module.exports = class HypercoreError extends Error {
  constructor (msg, code, fn = HypercoreError) {
    super(`${code}: ${msg}`)
    this.code = code

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, fn)
    }
  }

  get name () {
    return 'HypercoreError'
  }

  static ASSERTION (msg) { // ERR_ASSERTION is picked up by safety-catch also
    return new HypercoreError(msg, 'ERR_ASSERTION', HypercoreError.ASSERT)
  }

  static BAD_ARGUMENT (msg) {
    return new HypercoreError(msg, 'BAD_ARGUMENT', HypercoreError.BAD_ARGUMENT)
  }

  static STORAGE_EMPTY (msg) {
    return new HypercoreError(msg, 'STORAGE_EMPTY', HypercoreError.STORAGE_EMPTY)
  }

  static STORAGE_CONFLICT (msg) {
    return new HypercoreError(msg, 'STORAGE_CONFLICT', HypercoreError.STORAGE_CONFLICT)
  }

  static INVALID_SIGNATURE (msg) {
    return new HypercoreError(msg, 'INVALID_SIGNATURE', HypercoreError.INVALID_SIGNATURE)
  }

  static INVALID_CAPABILITY (msg) {
    return new HypercoreError(msg, 'INVALID_CAPABILITY', HypercoreError.INVALID_CAPABILITY)
  }

  static INVALID_CHECKSUM (msg = 'Invalid checksum') {
    return new HypercoreError(msg, 'INVALID_CHECKSUM', HypercoreError.INVALID_CHECKSUM)
  }

  static INVALID_OPERATION (msg) {
    return new HypercoreError(msg, 'INVALID_OPERATION', HypercoreError.INVALID_OPERATION)
  }

  static INVALID_PROOF (msg = 'Proof not verifiable') {
    return new HypercoreError(msg, 'INVALID_PROOF', HypercoreError.INVALID_PROOF)
  }

  static BLOCK_NOT_AVAILABLE (msg = 'Block is not available') {
    return new HypercoreError(msg, 'BLOCK_NOT_AVAILABLE', HypercoreError.BLOCK_NOT_AVAILABLE)
  }

  static SNAPSHOT_NOT_AVAILABLE (msg = 'Snapshot is not available') {
    return new HypercoreError(msg, 'SNAPSHOT_NOT_AVAILABLE', HypercoreError.SNAPSHOT_NOT_AVAILABLE)
  }

  static REQUEST_CANCELLED (msg = 'Request was cancelled') {
    return new HypercoreError(msg, 'REQUEST_CANCELLED', HypercoreError.REQUEST_CANCELLED)
  }

  static REQUEST_TIMEOUT (msg = 'Request timed out') {
    return new HypercoreError(msg, 'REQUEST_TIMEOUT', HypercoreError.REQUEST_TIMEOUT)
  }

  static SESSION_NOT_WRITABLE (msg = 'Session is not writable') {
    return new HypercoreError(msg, 'SESSION_NOT_WRITABLE', HypercoreError.SESSION_NOT_WRITABLE)
  }

  static SESSION_CLOSED (msg = 'Session is closed') {
    return new HypercoreError(msg, 'SESSION_CLOSED', HypercoreError.SESSION_CLOSED)
  }

  static BATCH_UNFLUSHED (msg = 'Batch not yet flushed') {
    return new HypercoreError(msg, 'BATCH_UNFLUSHED', HypercoreError.BATCH_UNFLUSHED)
  }

  static BATCH_ALREADY_EXISTS (msg = 'Batch already exists') {
    return new HypercoreError(msg, 'BATCH_ALREADY_EXISTS', HypercoreError.BATCH_ALREADY_EXISTS)
  }

  static BATCH_ALREADY_FLUSHED (msg = 'Batch has already been flushed') {
    return new HypercoreError(msg, 'BATCH_ALREADY_FLUSHED', HypercoreError.BATCH_ALREADY_FLUSHED)
  }

  static OPLOG_CORRUPT (msg = 'Oplog file appears corrupt or out of date') {
    return new HypercoreError(msg, 'OPLOG_CORRUPT', HypercoreError.OPLOG_CORRUPT)
  }

  static OPLOG_HEADER_OVERFLOW (msg = 'Oplog header exceeds page size') {
    return new HypercoreError(msg, 'OPLOG_HEADER_OVERFLOW', HypercoreError.OPLOG_HEADER_OVERFLOW)
  }

  static INVALID_OPLOG_VERSION (msg = 'Invalid header version') {
    return new HypercoreError(msg, 'INVALID_OPLOG_VERSION', HypercoreError.INVALID_OPLOG_VERSION)
  }

  static WRITE_FAILED (msg = 'Write to storage failed') {
    return new HypercoreError(msg, 'WRITE_FAILED', HypercoreError.WRITE_FAILED)
  }

  static DECODING_ERROR (msg = 'Decoding error') {
    return new HypercoreError(msg, 'DECODING_ERROR', HypercoreError.DECODING_ERROR)
  }

  static SESSION_MOVED (msg = 'Session moved') {
    return new HypercoreError(msg, 'SESSION_MOVED', HypercoreError.SESSION_MOVED)
  }
}
