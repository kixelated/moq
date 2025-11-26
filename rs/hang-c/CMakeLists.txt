cmake_minimum_required(VERSION 3.15)
project(hang VERSION 0.6.1 LANGUAGES C)

# Option to build the Rust library
option(BUILD_RUST_LIB "Build the Rust library using cargo" ON)

# Build the Rust library
if(BUILD_RUST_LIB)
    # Determine build profile
    if(CMAKE_BUILD_TYPE STREQUAL "Debug")
        set(CARGO_BUILD_TYPE "debug")
        set(CARGO_BUILD_FLAG "")
    else()
        set(CARGO_BUILD_TYPE "release")
        set(CARGO_BUILD_FLAG "--release")
    endif()

    # Determine library extension based on platform
    if(WIN32)
        set(LIB_PREFIX "")
        set(LIB_SUFFIX ".dll")
        set(IMPORT_SUFFIX ".dll.lib")
    elseif(APPLE)
        set(LIB_PREFIX "lib")
        set(LIB_SUFFIX ".dylib")
    else()
        set(LIB_PREFIX "lib")
        set(LIB_SUFFIX ".so")
    endif()

    # Set library paths
    set(RUST_LIB_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../target/${CARGO_BUILD_TYPE}")
    set(RUST_LIB_FILE "${RUST_LIB_DIR}/${LIB_PREFIX}hang${LIB_SUFFIX}")
    set(RUST_HEADER_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../target/include")
    set(RUST_HEADER_FILE "${RUST_HEADER_DIR}/hang.h")

    # Custom command to build the Rust library
    add_custom_command(
        OUTPUT ${RUST_LIB_FILE} ${RUST_HEADER_FILE}
        COMMAND cargo build ${CARGO_BUILD_FLAG}
        WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
        COMMENT "Building Rust library with cargo"
        VERBATIM
    )

    # Custom target for Rust build
    add_custom_target(rust_build ALL DEPENDS ${RUST_LIB_FILE} ${RUST_HEADER_FILE})
else()
    # User provides pre-built library
    set(RUST_LIB_DIR "${CMAKE_CURRENT_SOURCE_DIR}/lib" CACHE PATH "Directory containing pre-built library")
    set(RUST_HEADER_DIR "${CMAKE_CURRENT_SOURCE_DIR}/include" CACHE PATH "Directory containing header files")
    set(RUST_LIB_FILE "${RUST_LIB_DIR}/${LIB_PREFIX}hang${LIB_SUFFIX}")
    set(RUST_HEADER_FILE "${RUST_HEADER_DIR}/hang.h")
endif()

# Create imported library target
add_library(hang SHARED IMPORTED GLOBAL)
set_target_properties(hang PROPERTIES
    IMPORTED_LOCATION ${RUST_LIB_FILE}
    INTERFACE_INCLUDE_DIRECTORIES ${RUST_HEADER_DIR}
)

if(WIN32)
    set_target_properties(hang PROPERTIES
        IMPORTED_IMPLIB "${RUST_LIB_DIR}/hang${IMPORT_SUFFIX}"
    )
endif()

# Add dependency on Rust build if building from source
if(BUILD_RUST_LIB)
    add_dependencies(hang rust_build)
endif()

# Installation rules
include(GNUInstallDirs)

install(FILES ${RUST_HEADER_FILE}
    DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}
)

install(FILES ${RUST_LIB_FILE}
    DESTINATION ${CMAKE_INSTALL_LIBDIR}
)

# Export CMake targets
install(TARGETS hang
    EXPORT hang-targets
    LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
    ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
    RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
)

install(EXPORT hang-targets
    FILE hang-targets.cmake
    NAMESPACE hang::
    DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/hang
)

# Create and install package config file
include(CMakePackageConfigHelpers)

configure_package_config_file(
    ${CMAKE_CURRENT_SOURCE_DIR}/cmake/hang-config.cmake.in
    ${CMAKE_CURRENT_BINARY_DIR}/hang-config.cmake
    INSTALL_DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/hang
)

write_basic_package_version_file(
    ${CMAKE_CURRENT_BINARY_DIR}/hang-config-version.cmake
    VERSION ${PROJECT_VERSION}
    COMPATIBILITY SameMajorVersion
)

install(FILES
    ${CMAKE_CURRENT_BINARY_DIR}/hang-config.cmake
    ${CMAKE_CURRENT_BINARY_DIR}/hang-config-version.cmake
    DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/hang
)
