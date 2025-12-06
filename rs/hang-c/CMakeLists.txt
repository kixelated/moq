cmake_minimum_required(VERSION 3.21)
project(hang VERSION 0.6.1 LANGUAGES C)

option(BUILD_RUST_LIB "Build the Rust library using cargo" ON)

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

if(BUILD_RUST_LIB)
    if(CMAKE_BUILD_TYPE STREQUAL "Debug")
        set(CARGO_BUILD_TYPE "debug")
        set(CARGO_BUILD_FLAG "")
    else()
        set(CARGO_BUILD_TYPE "release")
        set(CARGO_BUILD_FLAG "--release")
    endif()

    set(RUST_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../target/${CARGO_BUILD_TYPE}")
    set(RUST_LIB "${RUST_DIR}/${LIB_PREFIX}hang${LIB_SUFFIX}")
    set(RUST_HEADER "${RUST_DIR}/hang.h")

    add_custom_target(rust_build ALL
        COMMAND cargo build ${CARGO_BUILD_FLAG}
        WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
        BYPRODUCTS ${RUST_LIB} ${RUST_HEADER}
        COMMENT "Building Rust library with cargo"
        VERBATIM
    )
else()
    set(RUST_DIR "${CMAKE_CURRENT_SOURCE_DIR}" CACHE PATH "Directory containing pre-built library and header")
    set(RUST_LIB "${RUST_DIR}/${LIB_PREFIX}hang${LIB_SUFFIX}")
    set(RUST_HEADER "${RUST_DIR}/hang.h")
endif()

# Ensure the directory exists (cargo build creates it)
file(MAKE_DIRECTORY ${RUST_DIR})

# Create imported library target
add_library(hang SHARED IMPORTED GLOBAL)
set_target_properties(hang PROPERTIES
    IMPORTED_LOCATION ${RUST_LIB}
    INTERFACE_INCLUDE_DIRECTORIES ${RUST_DIR}
)

if(WIN32)
    set_target_properties(hang PROPERTIES
        IMPORTED_IMPLIB "${RUST_DIR}/hang${IMPORT_SUFFIX}"
    )
endif()

if(BUILD_RUST_LIB)
    add_dependencies(hang rust_build)
endif()

if(PROJECT_IS_TOP_LEVEL)
    include(GNUInstallDirs)

    install(FILES ${RUST_HEADER}
        DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}
    )

    install(FILES ${RUST_LIB}
        DESTINATION ${CMAKE_INSTALL_LIBDIR}
    )

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
endif()
