//! # hang: Media over QUIC Library
//!
//! `hang` is a media-specific library built on top of [`moq_lite`], providing
//! high-level components for real-time audio and video streaming over QUIC.
//! It implements media containers, codecs, and streaming protocols optimized
//! for real-time live broadcasting.
//!
//! ## Overview
//!
//! While [`moq_lite`] provides the generic transport layer, `hang` adds:
//! - **Catalog**: A list of available tracks and their metadata.
//! - **Codec support**: Integration with common audio/video codecs
//! - **Container**: A simple timestamped container format.
//! - **CMAF Import**: Convert a fMP4 file into a hang broadcast.
//!
mod error;
mod model;

pub mod catalog;
pub mod cmaf;
pub mod feedback;

// export the moq-lite version in use
pub use moq_lite;

pub use catalog::{Catalog, CatalogConsumer, CatalogProducer};
pub use error::*;
pub use model::*;
