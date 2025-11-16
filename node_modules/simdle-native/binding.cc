#include <bare.h>
#include <js.h>
#include <jstl.h>
#include <simdle.h>
#include <stdint.h>

template <auto fn, typename T>
struct simdle_native_op_t {
  static bool
  predicate(
    js_env_t *env,
    js_receiver_t,
    js_typedarray_t<T> buf
  ) {
    int err;

    simdle_v128_t *buf_data;
    size_t buf_len;
    err = js_get_typedarray_info(env, buf, reinterpret_cast<T *&>(buf_data), buf_len);
    assert(err == 0);

    for (size_t i = 0, n = buf_len * sizeof(T) / 16; i < n; i++) {
      if (!fn(buf_data[i])) return false;
    }

    return true;
  }

  static void
  unary(
    js_env_t *env,
    js_receiver_t,
    js_typedarray_t<T> buf,
    js_typedarray_t<T> result
  ) {
    int err;

    simdle_v128_t *buf_data;
    size_t buf_len;
    err = js_get_typedarray_info(env, buf, reinterpret_cast<T *&>(buf_data), buf_len);
    assert(err == 0);

    simdle_v128_t *result_data;
    size_t result_len;
    err = js_get_typedarray_info(env, result, reinterpret_cast<T *&>(result_data), result_len);
    assert(err == 0);

    for (size_t i = 0, n = buf_len * sizeof(T) / 16; i < n; i++) {
      result_data[i] = fn(buf_data[i]);
    }
  }

  static void
  binary(
    js_env_t *env,
    js_receiver_t,
    js_typedarray_t<T> a_buf,
    js_typedarray_t<T> b_buf,
    js_typedarray_t<T> result_buf
  ) {
    int err;

    size_t len;

    simdle_v128_t *a;
    err = js_get_typedarray_info(env, a_buf, reinterpret_cast<T *&>(a), len);
    assert(err == 0);

    simdle_v128_t *b;
    err = js_get_typedarray_info(env, b_buf, reinterpret_cast<T *&>(b), len);
    assert(err == 0);

    simdle_v128_t *result;
    err = js_get_typedarray_info(env, result_buf, reinterpret_cast<T *&>(result), len);
    assert(err == 0);

    for (size_t i = 0, n = len * sizeof(T) / 16; i < n; i++) {
      result[i] = fn(a[i], b[i]);
    }
  }

  static int64_t
  reduce(
    js_env_t *env,
    js_receiver_t,
    js_typedarray_t<T> buf
  ) {
    simdle_v128_t *buf_data;
    size_t buf_len;
    int err = js_get_typedarray_info(env, buf, reinterpret_cast<T *&>(buf_data), buf_len);
    assert(err == 0);

    uint64_t result = 0;

    for (size_t i = 0, n = buf_len * sizeof(T) / 16; i < n; i++) {
      result += fn(buf_data[i]);
    }

    return result;
  }
};

constexpr auto simdle_native_allo_v128_u8 = simdle_native_op_t<simdle_allo_v128, uint8_t>::predicate;
constexpr auto simdle_native_allo_v128_u16 = simdle_native_op_t<simdle_allo_v128, uint16_t>::predicate;
constexpr auto simdle_native_allo_v128_u32 = simdle_native_op_t<simdle_allo_v128, uint32_t>::predicate;

constexpr auto simdle_native_allz_v128_u8 = simdle_native_op_t<simdle_allz_v128, uint8_t>::predicate;
constexpr auto simdle_native_allz_v128_u16 = simdle_native_op_t<simdle_allz_v128, uint16_t>::predicate;
constexpr auto simdle_native_allz_v128_u32 = simdle_native_op_t<simdle_allz_v128, uint32_t>::predicate;

constexpr auto simdle_native_cnt_v128_u8 = simdle_native_op_t<simdle_cnt_v128_u8, uint8_t>::unary;
constexpr auto simdle_native_cnt_v128_u16 = simdle_native_op_t<simdle_cnt_v128_u16, uint16_t>::unary;
constexpr auto simdle_native_cnt_v128_u32 = simdle_native_op_t<simdle_cnt_v128_u32, uint32_t>::unary;

constexpr auto simdle_native_clo_v128_u8 = simdle_native_op_t<simdle_clo_v128_u8, uint8_t>::unary;
constexpr auto simdle_native_clo_v128_u16 = simdle_native_op_t<simdle_clo_v128_u16, uint16_t>::unary;
constexpr auto simdle_native_clo_v128_u32 = simdle_native_op_t<simdle_clo_v128_u32, uint32_t>::unary;

constexpr auto simdle_native_clz_v128_u8 = simdle_native_op_t<simdle_clz_v128_u8, uint8_t>::unary;
constexpr auto simdle_native_clz_v128_u16 = simdle_native_op_t<simdle_clz_v128_u16, uint16_t>::unary;
constexpr auto simdle_native_clz_v128_u32 = simdle_native_op_t<simdle_clz_v128_u32, uint32_t>::unary;

constexpr auto simdle_native_cto_v128_u8 = simdle_native_op_t<simdle_cto_v128_u8, uint8_t>::unary;
constexpr auto simdle_native_cto_v128_u16 = simdle_native_op_t<simdle_cto_v128_u16, uint16_t>::unary;
constexpr auto simdle_native_cto_v128_u32 = simdle_native_op_t<simdle_cto_v128_u32, uint32_t>::unary;

constexpr auto simdle_native_ctz_v128_u8 = simdle_native_op_t<simdle_ctz_v128_u8, uint8_t>::unary;
constexpr auto simdle_native_ctz_v128_u16 = simdle_native_op_t<simdle_ctz_v128_u16, uint16_t>::unary;
constexpr auto simdle_native_ctz_v128_u32 = simdle_native_op_t<simdle_ctz_v128_u32, uint32_t>::unary;

constexpr auto simdle_native_not_v128_u8 = simdle_native_op_t<simdle_not_v128_u8, uint8_t>::unary;
constexpr auto simdle_native_not_v128_u16 = simdle_native_op_t<simdle_not_v128_u16, uint16_t>::unary;
constexpr auto simdle_native_not_v128_u32 = simdle_native_op_t<simdle_not_v128_u32, uint32_t>::unary;

constexpr auto simdle_native_and_v128_u8 = simdle_native_op_t<simdle_and_v128_u8, uint8_t>::binary;
constexpr auto simdle_native_and_v128_u16 = simdle_native_op_t<simdle_and_v128_u16, uint16_t>::binary;
constexpr auto simdle_native_and_v128_u32 = simdle_native_op_t<simdle_and_v128_u32, uint32_t>::binary;

constexpr auto simdle_native_clear_v128_u8 = simdle_native_op_t<simdle_clear_v128_u8, uint8_t>::binary;
constexpr auto simdle_native_clear_v128_u16 = simdle_native_op_t<simdle_clear_v128_u16, uint16_t>::binary;
constexpr auto simdle_native_clear_v128_u32 = simdle_native_op_t<simdle_clear_v128_u32, uint32_t>::binary;

constexpr auto simdle_native_or_v128_u8 = simdle_native_op_t<simdle_or_v128_u8, uint8_t>::binary;
constexpr auto simdle_native_or_v128_u16 = simdle_native_op_t<simdle_or_v128_u16, uint16_t>::binary;
constexpr auto simdle_native_or_v128_u32 = simdle_native_op_t<simdle_or_v128_u32, uint32_t>::binary;

constexpr auto simdle_native_xor_v128_u8 = simdle_native_op_t<simdle_xor_v128_u8, uint8_t>::binary;
constexpr auto simdle_native_xor_v128_u16 = simdle_native_op_t<simdle_xor_v128_u16, uint16_t>::binary;
constexpr auto simdle_native_xor_v128_u32 = simdle_native_op_t<simdle_xor_v128_u32, uint32_t>::binary;

constexpr auto simdle_native_sum_v128_u8 = simdle_native_op_t<simdle_sum_v128_u8, uint8_t>::reduce;
constexpr auto simdle_native_sum_v128_u16 = simdle_native_op_t<simdle_sum_v128_u16, uint16_t>::reduce;
constexpr auto simdle_native_sum_v128_u32 = simdle_native_op_t<simdle_sum_v128_u32, uint32_t>::reduce;

static js_value_t *
simdle_native_exports(js_env_t *env, js_value_t *exports) {
  int err;

#define V(fn) \
  err = js_set_property<fn>(env, exports, #fn); \
  assert(err == 0);

  V(simdle_native_allo_v128_u8);
  V(simdle_native_allo_v128_u16);
  V(simdle_native_allo_v128_u32);

  V(simdle_native_allz_v128_u8);
  V(simdle_native_allz_v128_u16);
  V(simdle_native_allz_v128_u32);

  V(simdle_native_cnt_v128_u8);
  V(simdle_native_cnt_v128_u16);
  V(simdle_native_cnt_v128_u32);

  V(simdle_native_clz_v128_u8);
  V(simdle_native_clz_v128_u16);
  V(simdle_native_clz_v128_u32);

  V(simdle_native_and_v128_u8);
  V(simdle_native_and_v128_u16);
  V(simdle_native_and_v128_u32);

  V(simdle_native_clear_v128_u8);
  V(simdle_native_clear_v128_u16);
  V(simdle_native_clear_v128_u32);

  V(simdle_native_clo_v128_u8);
  V(simdle_native_clo_v128_u16);
  V(simdle_native_clo_v128_u32);

  V(simdle_native_cto_v128_u8);
  V(simdle_native_cto_v128_u16);
  V(simdle_native_cto_v128_u32);

  V(simdle_native_ctz_v128_u8);
  V(simdle_native_ctz_v128_u16);
  V(simdle_native_ctz_v128_u32);

  V(simdle_native_not_v128_u8);
  V(simdle_native_not_v128_u16);
  V(simdle_native_not_v128_u32);

  V(simdle_native_or_v128_u8);
  V(simdle_native_or_v128_u16);
  V(simdle_native_or_v128_u32);

  V(simdle_native_sum_v128_u8);
  V(simdle_native_sum_v128_u16);
  V(simdle_native_sum_v128_u32);

  V(simdle_native_xor_v128_u8);
  V(simdle_native_xor_v128_u16);
  V(simdle_native_xor_v128_u32);
#undef V

  return exports;
}

BARE_MODULE(simdle_native, simdle_native_exports)
