//! The catalog describes available media tracks and codecs.
//!
//! This module provides JSON-based catalog functionality that allows broadcasters
//! to describe their available audio and video tracks, including codec information,
//! resolution, bitrates, and other metadata. Consumers can subscribe to catalog
//! tracks to discover and choose appropriate tracks for their capabilities.

mod audio;
mod location;
mod root;
mod version;
mod video;

pub use audio::*;
pub use location::*;
pub use root::*;
pub use version::*;
pub use video::*;
