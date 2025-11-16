const binding = require('./binding')
const b4a = require('b4a')

function predicate(u8, u16, u32) {
  return function predicate(buf) {
    if (buf.byteLength % 16 !== 0) {
      throw new Error('Buffer length must be a multiple of 16')
    }

    const n = buf.BYTES_PER_ELEMENT

    if (n === 1) return u8(buf)
    if (n === 2) return u16(buf)
    return u32(buf)
  }
}

function unary(u8, u16, u32) {
  return function unary(buf, result = b4a.allocUnsafe(buf.byteLength)) {
    if (buf.byteLength % 16 !== 0) {
      throw new Error('Buffer length must be a multiple of 16')
    }

    if (buf.byteLength !== result.byteLength) {
      throw new Error('Length of result buffer is insufficient')
    }

    const n = buf.BYTES_PER_ELEMENT

    if (n === 1) u8(buf, result)
    else if (n === 2) u16(buf, result)
    else u32(buf, result)

    return result
  }
}

function binary(u8, u16, u32) {
  return function binary(a, b, result = b4a.allocUnsafe(a.byteLength)) {
    if (a.byteLength % 16 !== 0) {
      throw new Error('Buffer length must be a multiple of 16')
    }

    if (a.byteLength !== b.byteLength || a.byteLength !== result.byteLength) {
      throw new Error('Buffers must be the same length')
    }

    const n = a.BYTES_PER_ELEMENT

    if (n === 1) u8(a, b, result)
    else if (n === 2) u16(a, b, result)
    else u32(a, b, result)

    return result
  }
}

function reduce(u8, u16, u32) {
  return function reduce(buf) {
    if (buf.byteLength % 16 !== 0) {
      throw new Error('Buffer length must be a multiple of 16')
    }

    const n = buf.BYTES_PER_ELEMENT

    if (n === 1) return u8(buf)
    if (n === 2) return u16(buf)
    return u32(buf)
  }
}

exports.allo = predicate(
  binding.simdle_native_allo_v128_u8,
  binding.simdle_native_allo_v128_u16,
  binding.simdle_native_allo_v128_u32
)

exports.allz = predicate(
  binding.simdle_native_allz_v128_u8,
  binding.simdle_native_allz_v128_u16,
  binding.simdle_native_allz_v128_u32
)

exports.and = binary(
  binding.simdle_native_and_v128_u8,
  binding.simdle_native_and_v128_u16,
  binding.simdle_native_and_v128_u32
)

exports.clear = binary(
  binding.simdle_native_clear_v128_u8,
  binding.simdle_native_clear_v128_u16,
  binding.simdle_native_clear_v128_u32
)

exports.clo = unary(
  binding.simdle_native_clo_v128_u8,
  binding.simdle_native_clo_v128_u16,
  binding.simdle_native_clo_v128_u32
)

exports.clz = unary(
  binding.simdle_native_clz_v128_u8,
  binding.simdle_native_clz_v128_u16,
  binding.simdle_native_clz_v128_u32
)

exports.cnt = unary(
  binding.simdle_native_cnt_v128_u8,
  binding.simdle_native_cnt_v128_u16,
  binding.simdle_native_cnt_v128_u32
)

exports.cto = unary(
  binding.simdle_native_cto_v128_u8,
  binding.simdle_native_cto_v128_u16,
  binding.simdle_native_cto_v128_u32
)

exports.ctz = unary(
  binding.simdle_native_ctz_v128_u8,
  binding.simdle_native_ctz_v128_u16,
  binding.simdle_native_ctz_v128_u32
)

exports.not = unary(
  binding.simdle_native_not_v128_u8,
  binding.simdle_native_not_v128_u16,
  binding.simdle_native_not_v128_u32
)

exports.or = binary(
  binding.simdle_native_or_v128_u8,
  binding.simdle_native_or_v128_u16,
  binding.simdle_native_or_v128_u32
)

exports.sum = reduce(
  binding.simdle_native_sum_v128_u8,
  binding.simdle_native_sum_v128_u16,
  binding.simdle_native_sum_v128_u32
)

exports.xor = binary(
  binding.simdle_native_xor_v128_u8,
  binding.simdle_native_xor_v128_u16,
  binding.simdle_native_xor_v128_u32
)
