//! The catalog describes available media tracks and codecs.
//!
//! This module provides JSON-based catalog functionality that allows broadcasters
//! to describe their available audio and video tracks, including codec information,
//! resolution, bitrates, and other metadata. Consumers can subscribe to catalog
//! tracks to discover and choose appropriate tracks for their capabilities.

mod audio;
mod chat;
mod location;
mod preview;
mod root;
mod track;
mod user;
mod video;

pub use audio::*;
pub use chat::*;
pub use location::*;
pub use preview::*;
pub use root::*;
pub use track::*;
pub use user::*;
pub use video::*;
