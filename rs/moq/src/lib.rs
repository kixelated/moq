//! # moq-lite: Media over QUIC Transport
//!
//! `moq-lite` is a simplified implementation of the Media over QUIC (MoQ) transport protocol,
//! designed for real-time live media delivery with sub-second latency at scale.
//! It's a fork of the IETF MoQ specification, optimized for practical deployment.
//!
//! ## Overview
//!
//! MoQ is a pub/sub protocol built on top of QUIC that provides:
//! - **Real-time latency**: Sub-second delivery for live media
//! - **Massive scale**: CDN-like distribution via relay clustering
//! - **Network efficiency**: Leverages QUIC's multiplexing and partial reliability
//! - **Browser compatibility**: Works with WebTransport for web applications
//!
//! While designed for media, the transport is generic and can handle any live data streams.

mod error;
mod model;
mod session;

pub mod coding;
pub mod message;
pub use error::*;
pub use model::*;
pub use session::*;

pub use message::{Path, PathRef};

/// The ALPN used when connecting via QUIC directly.
pub const ALPN: &str = message::Alpn::CURRENT.0;

/// Export the web_transport crate.
pub use web_transport;
