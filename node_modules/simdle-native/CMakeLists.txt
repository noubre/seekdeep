cmake_minimum_required(VERSION 3.25)

find_package(cmake-bare REQUIRED PATHS node_modules/cmake-bare)
find_package(cmake-fetch REQUIRED PATHS node_modules/cmake-fetch)
find_package(cmake-napi REQUIRED PATHS node_modules/cmake-napi)

project(simdle_native C CXX)

bare_target(target)

if(target MATCHES "win32")
  add_compile_options(/MT$<$<CONFIG:Debug>:d>)
endif()

fetch_package("github:holepunchto/libsimdle#014ad4e")
fetch_package("github:holepunchto/libjstl#098664c")

add_bare_module(simdle_native_bare)

target_sources(
  ${simdle_native_bare}
  PRIVATE
    binding.cc
)

target_link_libraries(
  ${simdle_native_bare}
  PRIVATE
    $<TARGET_OBJECTS:simdle>
    jstl
  PUBLIC
    simdle
)

add_napi_module(simdle_native_node)

target_sources(
  ${simdle_native_node}
  PRIVATE
    binding.cc
)

target_link_libraries(
  ${simdle_native_node}
  PRIVATE
    $<TARGET_OBJECTS:simdle>
    jstl
  PUBLIC
    simdle
)

target_compile_definitions(
  ${simdle_native_node}
  PRIVATE
    NAPI_VERSION=9
)

resolve_node_module(bare-compat-napi compat)

target_include_directories(
  ${simdle_native_node}
  PRIVATE
    "${compat}/include"
)
