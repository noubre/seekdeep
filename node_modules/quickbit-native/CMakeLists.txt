cmake_minimum_required(VERSION 3.31)

find_package(cmake-bare REQUIRED PATHS node_modules/cmake-bare)
find_package(cmake-fetch REQUIRED PATHS node_modules/cmake-fetch)
find_package(cmake-napi REQUIRED PATHS node_modules/cmake-napi)

project(quickbit_native C CXX)

bare_target(target)

if(target MATCHES "win32")
  add_compile_options(/MT$<$<CONFIG:Debug>:d>)
endif()

fetch_package("github:holepunchto/libquickbit#5ecf908")
fetch_package("github:holepunchto/libjstl#d08e05c")

add_bare_module(quickbit_native_bare)

target_sources(
  ${quickbit_native_bare}
  PRIVATE
    binding.cc
)

target_link_libraries(
  ${quickbit_native_bare}
  PRIVATE
    $<TARGET_OBJECTS:quickbit>
    $<TARGET_OBJECTS:simdle>
  PUBLIC
    quickbit
    simdle
  PRIVATE
    jstl
)

add_napi_module(quickbit_native_node)

target_sources(
  ${quickbit_native_node}
  PRIVATE
    binding.cc
)

target_compile_definitions(
  ${quickbit_native_node}
  PRIVATE
    NAPI_VERSION=9
)

target_link_libraries(
  ${quickbit_native_node}
  PRIVATE
    $<TARGET_OBJECTS:quickbit>
    $<TARGET_OBJECTS:simdle>
  PUBLIC
    quickbit
    simdle
  PRIVATE
    jstl
)

resolve_node_module(bare-compat-napi compat)

target_include_directories(
  ${quickbit_native_node}
  PRIVATE
    "${compat}/include"
)
