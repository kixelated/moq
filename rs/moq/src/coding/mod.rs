//! This module contains encoding and decoding helpers.

mod decode;
mod encode;
mod extensions;
mod reader;
mod size;
mod stream;
mod varint;
mod version;
mod writer;

pub use decode::*;
pub use encode::*;
pub use extensions::*;
pub use reader::*;
pub use size::*;
pub use stream::*;
pub use varint::*;
pub use version::*;
pub use writer::*;

// Re-export the bytes crate
pub use bytes::*;
