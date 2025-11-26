# hang-c

C bindings for the hang Media over QUIC library.

## Building

### Build the Rust library and generate C headers

```bash
cargo build --release
```

This will:
- Build the shared library (`libhang.dylib` on macOS, `libhang.so` on Linux, `hang.dll` on Windows)
- Generate the C header file at `target/include/hang.h`
- Generate the pkg-config file at `target/hang.pc`

The library is built as a `cdylib` by default. To build as a static library, edit `Cargo.toml` and change:
```toml
crate-type = ["cdylib"]
```
to:
```toml
crate-type = ["staticlib"]
```

## Using with CMake

### Option 1: Build from source

```cmake
add_subdirectory(path/to/hang-c)
target_link_libraries(your_target PRIVATE hang::hang)
```

### Option 2: Use pre-built library

```cmake
find_package(hang REQUIRED)
target_link_libraries(your_target PRIVATE hang::hang)
```

### CMake Options

- `BUILD_RUST_LIB` (default: ON) - Build the Rust library using cargo
- `RUST_LIB_DIR` - Directory containing pre-built library (when `BUILD_RUST_LIB=OFF`)
- `RUST_HEADER_DIR` - Directory containing header files (when `BUILD_RUST_LIB=OFF`)

## Using with pkg-config

After installation, you can use pkg-config:

```bash
pkg-config --cflags hang
pkg-config --libs hang
```

In your build system:
```makefile
CFLAGS += $(shell pkg-config --cflags hang)
LDFLAGS += $(shell pkg-config --libs hang)
```

## API

The library exposes the following C functions (see `hang.h` for full details):

### `hang_start_from_c`
```c
void hang_start_from_c(const char *c_server_url, const char *c_path, const char *_c_profile);
```
Start the MoQ client and connect to a server.

**Safety**: The caller must ensure that `c_server_url` and `c_path` are valid null-terminated C strings.

### `hang_stop_from_c`
```c
void hang_stop_from_c(void);
```
Stop the MoQ client.

### `hang_write_video_packet_from_c`
```c
void hang_write_video_packet_from_c(const uint8_t *data, uintptr_t size, int32_t keyframe, uint64_t dts);
```
Write a video packet to the stream.

**Safety**: The caller must ensure that `data` points to a valid buffer of at least `size` bytes.

## Example Usage

```c
#include <hang.h>

int main() {
    // Start the client
    hang_start_from_c("https://localhost:4443", "mybroadcast", NULL);

    // Send video packets
    uint8_t packet_data[1024] = {/* ... */};
    hang_write_video_packet_from_c(packet_data, sizeof(packet_data), 1, 0);

    // Stop the client
    hang_stop_from_c();

    return 0;
}
```

## Installation

### Using CMake

```bash
cd rs/hang-c
mkdir build && cd build
cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build .
sudo cmake --install .
```

This will install:
- Header file to `/usr/local/include/hang.h`
- Shared library to `/usr/local/lib/libhang.{dylib,so,dll}`
- CMake config files to `/usr/local/lib/cmake/hang/`
- pkg-config file to `/usr/local/lib/pkgconfig/hang.pc` (if installed manually)

### Manual Installation

```bash
# Build the library
cargo build --release

# Copy header
sudo cp target/include/hang.h /usr/local/include/

# Copy library
sudo cp target/release/libhang.{dylib,so,dll} /usr/local/lib/

# Copy and configure pkg-config file
sed 's|@PREFIX@|/usr/local|g; s|@VERSION@|0.6.1|g' hang.pc.in > hang.pc
sudo cp hang.pc /usr/local/lib/pkgconfig/
```

## Build System Integration

### Makefile

```makefile
CC = gcc
CFLAGS = -I../../target/include
LDFLAGS = -L../../target/release -lhang

myapp: myapp.c
	$(CC) $(CFLAGS) -o $@ $< $(LDFLAGS)
```

### Meson

```meson
hang_dep = dependency('hang')
executable('myapp', 'myapp.c', dependencies: hang_dep)
```

## Notes

- The library uses a background thread for async operations
- All string parameters must be null-terminated C strings
- The library handles memory management internally - don't free pointers returned by the library
- Video packets are copied internally, so you can free your buffers after calling `hang_write_video_packet_from_c`
