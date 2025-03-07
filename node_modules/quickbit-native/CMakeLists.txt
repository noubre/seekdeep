cmake_minimum_required(VERSION 3.25)

find_package(cmake-bare REQUIRED PATHS node_modules/cmake-bare)
find_package(cmake-fetch REQUIRED PATHS node_modules/cmake-fetch)
find_package(cmake-napi REQUIRED PATHS node_modules/cmake-napi)

project(quickbit_native C)

bare_target(target)

if(target MATCHES "win32")
  add_compile_options(/MT$<$<CONFIG:Debug>:d>)
endif()

fetch_package("github:holepunchto/libquickbit#5ecf908")

add_bare_module(quickbit_native_bare)

target_sources(
  ${quickbit_native_bare}
  PRIVATE
    binding.c
)

target_link_libraries(
  ${quickbit_native_bare}
  PRIVATE
    $<TARGET_OBJECTS:quickbit>
    $<TARGET_OBJECTS:simdle>
  PUBLIC
    quickbit
    simdle
)

add_napi_module(quickbit_native_node)

target_sources(
  ${quickbit_native_node}
  PRIVATE
    binding.c
)

target_link_libraries(
  ${quickbit_native_node}
  PRIVATE
    $<TARGET_OBJECTS:quickbit>
    $<TARGET_OBJECTS:simdle>
  PUBLIC
    quickbit
    simdle
)
