#include <bare.h>
#include <js.h>
#include <jstl.h>
#include <quickbit.h>

template <>
struct js_type_info_t<quickbit_chunk_t> {
  using type = js_value_t *;

  static constexpr auto signature = js_object;

  template <js_type_options_t options>
  static auto
  unmarshall(js_env_t *env, js_value_t *value, quickbit_chunk_t &chunk) {
    int err;

    js_typedarray_span_t<uint8_t> field;
    err = js_get_property(env, value, "field", field);
    if (err < 0) return err;

    uint32_t offset;
    err = js_get_property(env, value, "offset", offset);
    if (err < 0) return err;

    chunk = {
      .field = field.data(),
      .len = field.size(),
      .offset = offset,
    };

    return 0;
  }
};

static inline uint32_t
quickbit_napi_get(
  js_env_t *env,
  js_receiver_t,
  js_typedarray_span_t<uint8_t> field,
  int32_t bit
) {
  return quickbit_get(field.data(), field.size(), bit);
}

static inline uint32_t
quickbit_napi_set(
  js_env_t *env,
  js_receiver_t,
  js_typedarray_span_t<uint8_t> field,
  int32_t bit,
  uint32_t value
) {
  return quickbit_set(field.data(), field.size(), bit, value);
}

static inline void
quickbit_napi_fill(
  js_env_t *env,
  js_receiver_t,
  js_typedarray_span_t<uint8_t> field,
  uint32_t value,
  int32_t start,
  int32_t end
) {
  quickbit_fill(field.data(), field.size(), value, start, end);
}

static inline void
quickbit_napi_clear(
  js_env_t *env,
  js_receiver_t,
  js_typedarray_span_t<uint8_t> field,
  std::vector<quickbit_chunk_t> chunks
) {
  for (auto &chunk : chunks) {
    quickbit_clear(field.data(), field.size(), &chunk);
  }
}

static inline int32_t
quickbit_napi_find_first(
  js_env_t *env,
  js_receiver_t,
  js_typedarray_span_t<uint8_t> field,
  uint32_t value,
  int32_t position
) {
  return quickbit_find_first(field.data(), field.size(), value, position);
}

static inline int32_t
quickbit_napi_find_last(
  js_env_t *env,
  js_receiver_t,
  js_typedarray_span_t<uint8_t> field,
  uint32_t value,
  int32_t position
) {
  return quickbit_find_last(field.data(), field.size(), value, position);
}

static inline void
quickbit_napi_index_init(
  js_env_t *env,
  js_receiver_t,
  js_typedarray_span_t<uint8_t> index,
  js_typedarray_span_t<uint8_t> field
) {
  quickbit_index_init(index.data(), field.data(), field.size());
}

static inline void
quickbit_napi_index_init_sparse(
  js_env_t *env,
  js_receiver_t,
  js_typedarray_span_t<uint8_t> index,
  std::vector<quickbit_chunk_t> chunks
) {
  quickbit_index_init_sparse(index.data(), chunks.data(), chunks.size());
}

static inline uint32_t
quickbit_napi_index_update(
  js_env_t *env,
  js_receiver_t,
  js_typedarray_span_t<uint8_t> index,
  js_typedarray_span_t<uint8_t> field,
  int32_t bit
) {
  return quickbit_index_update(index.data(), field.data(), field.size(), bit);
}

static inline uint32_t
quickbit_napi_index_update_sparse(
  js_env_t *env,
  js_receiver_t,
  js_typedarray_span_t<uint8_t> index,
  js_typedarray_span_t<uint8_t> field,
  uint32_t offset,
  int32_t bit
) {
  quickbit_chunk_t chunk = {
    .field = field.data(),
    .len = field.size(),
    .offset = offset,
  };

  return quickbit_index_update_sparse(index.data(), &chunk, 1, bit);
}

static inline uint32_t
quickbit_napi_skip_first(
  js_env_t *env,
  js_receiver_t,
  js_typedarray_span_t<uint8_t> index,
  uint32_t len,
  uint32_t value,
  int32_t position
) {
  return quickbit_skip_first(index.data(), len, value, position);
}

static inline uint32_t
quickbit_napi_skip_last(
  js_env_t *env,
  js_receiver_t,
  js_typedarray_span_t<uint8_t> index,
  uint32_t len,
  uint32_t value,
  int32_t position
) {
  return quickbit_skip_last(index.data(), len, value, position);
}

static js_value_t *
quickbit_napi_exports(js_env_t *env, js_value_t *exports) {
  int err;

  err = js_set_property(env, exports, "sizeof_quickbit_index_t", uint32_t(sizeof(quickbit_index_t)));
  assert(err == 0);

  err = js_set_property<quickbit_napi_get>(env, exports, "quickbit_napi_get");
  assert(err == 0);

  err = js_set_property<quickbit_napi_set>(env, exports, "quickbit_napi_set");
  assert(err == 0);

  err = js_set_property<quickbit_napi_fill>(env, exports, "quickbit_napi_fill");
  assert(err == 0);

  err = js_set_property<quickbit_napi_clear>(env, exports, "quickbit_napi_clear");
  assert(err == 0);

  err = js_set_property<quickbit_napi_find_first>(env, exports, "quickbit_napi_find_first");
  assert(err == 0);

  err = js_set_property<quickbit_napi_find_last>(env, exports, "quickbit_napi_find_last");
  assert(err == 0);

  err = js_set_property<quickbit_napi_index_init>(env, exports, "quickbit_napi_index_init");
  assert(err == 0);

  err = js_set_property<quickbit_napi_index_init_sparse>(env, exports, "quickbit_napi_index_init_sparse");
  assert(err == 0);

  err = js_set_property<quickbit_napi_index_update>(env, exports, "quickbit_napi_index_update");
  assert(err == 0);

  err = js_set_property<quickbit_napi_index_update_sparse>(env, exports, "quickbit_napi_index_update_sparse");
  assert(err == 0);

  err = js_set_property<quickbit_napi_skip_first>(env, exports, "quickbit_napi_skip_first");
  assert(err == 0);

  err = js_set_property<quickbit_napi_skip_last>(env, exports, "quickbit_napi_skip_last");
  assert(err == 0);

  return exports;
}

BARE_MODULE(quickbit_napi, quickbit_napi_exports)
