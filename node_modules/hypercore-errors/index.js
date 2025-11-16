const IdEnc = require('hypercore-id-encoding')

module.exports = class HypercoreError extends Error {
  constructor (msg, code, fn = HypercoreError, discoveryKey = null) {
    if (discoveryKey) msg = `${msg} (discovery key: ${IdEnc.normalize(discoveryKey)})`
    super(`${code}: ${msg}`)

    this.code = code
    this.discoveryKey = discoveryKey

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, fn)
    }
  }

  get name () {
    return 'HypercoreError'
  }

  static ASSERTION (msg, discoveryKey = null) { // ERR_ASSERTION is picked up by safety-catch also
    return new HypercoreError(msg, 'ERR_ASSERTION', HypercoreError.ASSERT, discoveryKey)
  }

  static BAD_ARGUMENT (msg, discoveryKey = null) {
    return new HypercoreError(msg, 'BAD_ARGUMENT', HypercoreError.BAD_ARGUMENT, discoveryKey)
  }

  static STORAGE_EMPTY (msg, discoveryKey = null) {
    return new HypercoreError(msg, 'STORAGE_EMPTY', HypercoreError.STORAGE_EMPTY, discoveryKey)
  }

  static STORAGE_CONFLICT (msg, discoveryKey = null) {
    return new HypercoreError(msg, 'STORAGE_CONFLICT', HypercoreError.STORAGE_CONFLICT, discoveryKey)
  }

  static INVALID_SIGNATURE (msg, discoveryKey = null) {
    return new HypercoreError(msg, 'INVALID_SIGNATURE', HypercoreError.INVALID_SIGNATURE, discoveryKey)
  }

  static INVALID_CAPABILITY (msg, discoveryKey = null) {
    return new HypercoreError(msg, 'INVALID_CAPABILITY', HypercoreError.INVALID_CAPABILITY, discoveryKey)
  }

  static INVALID_CHECKSUM (msg = 'Invalid checksum', discoveryKey = null) {
    return new HypercoreError(msg, 'INVALID_CHECKSUM', HypercoreError.INVALID_CHECKSUM, discoveryKey)
  }

  static INVALID_OPERATION (msg, discoveryKey = null) {
    return new HypercoreError(msg, 'INVALID_OPERATION', HypercoreError.INVALID_OPERATION, discoveryKey)
  }

  static INVALID_PROOF (msg = 'Proof not verifiable', discoveryKey = null) {
    return new HypercoreError(msg, 'INVALID_PROOF', HypercoreError.INVALID_PROOF, discoveryKey)
  }

  static BLOCK_NOT_AVAILABLE (msg = 'Block is not available', discoveryKey = null) {
    return new HypercoreError(msg, 'BLOCK_NOT_AVAILABLE', HypercoreError.BLOCK_NOT_AVAILABLE, discoveryKey)
  }

  static SNAPSHOT_NOT_AVAILABLE (msg = 'Snapshot is not available', discoveryKey = null) {
    return new HypercoreError(msg, 'SNAPSHOT_NOT_AVAILABLE', HypercoreError.SNAPSHOT_NOT_AVAILABLE, discoveryKey)
  }

  static REQUEST_CANCELLED (msg = 'Request was cancelled', discoveryKey = null) {
    return new HypercoreError(msg, 'REQUEST_CANCELLED', HypercoreError.REQUEST_CANCELLED, discoveryKey)
  }

  static REQUEST_TIMEOUT (msg = 'Request timed out', discoveryKey = null) {
    return new HypercoreError(msg, 'REQUEST_TIMEOUT', HypercoreError.REQUEST_TIMEOUT, discoveryKey)
  }

  static SESSION_NOT_WRITABLE (msg = 'Session is not writable', discoveryKey = null) {
    return new HypercoreError(msg, 'SESSION_NOT_WRITABLE', HypercoreError.SESSION_NOT_WRITABLE, discoveryKey)
  }

  static SESSION_CLOSED (msg = 'Session is closed', discoveryKey = null) {
    return new HypercoreError(msg, 'SESSION_CLOSED', HypercoreError.SESSION_CLOSED, discoveryKey)
  }

  static BATCH_UNFLUSHED (msg = 'Batch not yet flushed', discoveryKey = null) {
    return new HypercoreError(msg, 'BATCH_UNFLUSHED', HypercoreError.BATCH_UNFLUSHED, discoveryKey)
  }

  static BATCH_ALREADY_EXISTS (msg = 'Batch already exists', discoveryKey = null) {
    return new HypercoreError(msg, 'BATCH_ALREADY_EXISTS', HypercoreError.BATCH_ALREADY_EXISTS, discoveryKey)
  }

  static BATCH_ALREADY_FLUSHED (msg = 'Batch has already been flushed', discoveryKey = null) {
    return new HypercoreError(msg, 'BATCH_ALREADY_FLUSHED', HypercoreError.BATCH_ALREADY_FLUSHED, discoveryKey)
  }

  static OPLOG_CORRUPT (msg = 'Oplog file appears corrupt or out of date', discoveryKey = null) {
    return new HypercoreError(msg, 'OPLOG_CORRUPT', HypercoreError.OPLOG_CORRUPT, discoveryKey)
  }

  static OPLOG_HEADER_OVERFLOW (msg = 'Oplog header exceeds page size', discoveryKey = null) {
    return new HypercoreError(msg, 'OPLOG_HEADER_OVERFLOW', HypercoreError.OPLOG_HEADER_OVERFLOW, discoveryKey)
  }

  static INVALID_OPLOG_VERSION (msg = 'Invalid header version', discoveryKey = null) {
    return new HypercoreError(msg, 'INVALID_OPLOG_VERSION', HypercoreError.INVALID_OPLOG_VERSION, discoveryKey)
  }

  static WRITE_FAILED (msg = 'Write to storage failed', discoveryKey = null) {
    return new HypercoreError(msg, 'WRITE_FAILED', HypercoreError.WRITE_FAILED, discoveryKey)
  }

  static DECODING_ERROR (msg = 'Decoding error', discoveryKey = null) {
    return new HypercoreError(msg, 'DECODING_ERROR', HypercoreError.DECODING_ERROR, discoveryKey)
  }

  static SESSION_MOVED (msg = 'Session moved', discoveryKey = null) {
    return new HypercoreError(msg, 'SESSION_MOVED', HypercoreError.SESSION_MOVED, discoveryKey)
  }
}
