#!/usr/bin/env bash
set -euo pipefail

# Build and package hang-c for release.
# Usage: ./release.sh [--target TARGET] [--version VERSION] [--skip-build] [--output DIR]
#
# Examples:
#   ./release.sh                                    # Build for host, detect version from Cargo.toml
#   ./release.sh --target aarch64-apple-darwin      # Cross-compile for Apple Silicon
#   ./release.sh --skip-build                       # Package existing build artifacts

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE_DIR="$(cd "$RS_DIR/.." && pwd)"

# Defaults
TARGET=""
VERSION=""
SKIP_BUILD=false
OUTPUT_DIR="$WORKSPACE_DIR/dist"

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --target)
            TARGET="$2"
            shift 2
            ;;
        --version)
            VERSION="$2"
            shift 2
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --output)
            OUTPUT_DIR="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [--target TARGET] [--version VERSION] [--skip-build] [--output DIR]"
            exit 0
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 1
            ;;
    esac
done

# Detect target if not specified
if [[ -z "$TARGET" ]]; then
    TARGET=$(rustc -vV | grep host | cut -d' ' -f2)
    echo "Detected target: $TARGET"
fi

# Get version from Cargo.toml if not specified
if [[ -z "$VERSION" ]]; then
    VERSION=$(grep '^version' "$SCRIPT_DIR/Cargo.toml" | head -1 | sed 's/.*"\(.*\)".*/\1/')
    echo "Detected version: $VERSION"
fi

# Build if not skipping
if [[ "$SKIP_BUILD" == false ]]; then
    echo "Building hang-c for $TARGET..."

    # Set up cross-compilation for Linux ARM64
    if [[ "$TARGET" == "aarch64-unknown-linux-gnu" ]]; then
        export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_LINKER=aarch64-linux-gnu-gcc
    fi

    cargo build --release --package hang-c --target "$TARGET" --manifest-path "$RS_DIR/Cargo.toml"
fi

# Determine paths
TARGET_DIR="$RS_DIR/target/$TARGET/release"
NAME="hang-${VERSION}-${TARGET}"
PACKAGE_DIR="$OUTPUT_DIR/$NAME"

echo "Packaging $NAME..."

# Clean and create package directory
rm -rf "$PACKAGE_DIR"
mkdir -p "$PACKAGE_DIR/include" "$PACKAGE_DIR/lib"

# Copy header
if [[ -f "$TARGET_DIR/hang.h" ]]; then
    cp "$TARGET_DIR/hang.h" "$PACKAGE_DIR/include/"
else
    echo "Error: hang.h not found at $TARGET_DIR/hang.h" >&2
    exit 1
fi

# Copy libraries based on platform
case "$TARGET" in
    *-apple-*)
        cp "$TARGET_DIR/libhang.dylib" "$PACKAGE_DIR/lib/"
        cp "$TARGET_DIR/libhang.a" "$PACKAGE_DIR/lib/"
        ;;
    *-windows-*)
        cp "$TARGET_DIR/hang.dll" "$PACKAGE_DIR/lib/"
        cp "$TARGET_DIR/hang.dll.lib" "$PACKAGE_DIR/lib/"
        cp "$TARGET_DIR/hang.lib" "$PACKAGE_DIR/lib/"
        ;;
    *)
        # Linux and others
        cp "$TARGET_DIR/libhang.so" "$PACKAGE_DIR/lib/"
        cp "$TARGET_DIR/libhang.a" "$PACKAGE_DIR/lib/"
        ;;
esac

# Generate pkg-config file (not for Windows)
if [[ "$TARGET" != *"-windows-"* ]]; then
    mkdir -p "$PACKAGE_DIR/lib/pkgconfig"
    cat > "$PACKAGE_DIR/lib/pkgconfig/hang.pc" << EOF
prefix=/usr/local
exec_prefix=\${prefix}
libdir=\${exec_prefix}/lib
includedir=\${prefix}/include

Name: hang
Description: Media over QUIC C Library
Version: ${VERSION}
Libs: -L\${libdir} -lhang
Cflags: -I\${includedir}
EOF
fi

# Create archive
cd "$OUTPUT_DIR"
if [[ "$TARGET" == *"-windows-"* ]]; then
    ARCHIVE="$NAME.zip"
    if command -v 7z &> /dev/null; then
        7z a "$ARCHIVE" "$NAME"
    elif command -v zip &> /dev/null; then
        zip -r "$ARCHIVE" "$NAME"
    else
        echo "Error: Neither 7z nor zip found" >&2
        exit 1
    fi
else
    ARCHIVE="$NAME.tar.gz"
    tar -czvf "$ARCHIVE" "$NAME"
fi

# Clean up directory, keep archive
rm -rf "$PACKAGE_DIR"

echo ""
echo "Created: $OUTPUT_DIR/$ARCHIVE"
echo "$ARCHIVE"
