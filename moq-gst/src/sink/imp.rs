use anyhow::Context as _;
use gst::glib;
use gst::prelude::*;
use gst::subclass::prelude::*;
use gst_base::subclass::prelude::*;

use moq_karp::moq_transfork;

use moq_native::{quic, tls};
use once_cell::sync::Lazy;
use std::sync::Arc;
use std::sync::Mutex;

pub static RUNTIME: Lazy<tokio::runtime::Runtime> = Lazy::new(|| {
	tokio::runtime::Builder::new_multi_thread()
		.enable_all()
		.worker_threads(1)
		.build()
		.unwrap()
});

#[derive(Default, Clone)]
struct Settings {
	pub url: Option<String>,
	pub room: String,
	pub broadcast: String,
	pub tls_disable_verify: bool,
}

#[derive(Default)]
struct State {
	pub media: Option<moq_karp::cmaf::Import>,
}

#[derive(Default)]
pub struct MoqSink {
	settings: Mutex<Settings>,
	state: Arc<Mutex<State>>,
}

#[glib::object_subclass]
impl ObjectSubclass for MoqSink {
	const NAME: &'static str = "MoqSink";
	type Type = super::MoqSink;
	type ParentType = gst_base::BaseSink;

	fn new() -> Self {
		Self::default()
	}
}

impl ObjectImpl for MoqSink {
	fn properties() -> &'static [glib::ParamSpec] {
		static PROPERTIES: Lazy<Vec<glib::ParamSpec>> = Lazy::new(|| {
			vec![
				glib::ParamSpecString::builder("url")
					.nick("URL")
					.blurb("Connect to the subscriber at the given URL")
					.build(),
				glib::ParamSpecString::builder("room")
					.nick("Room")
					.blurb("Publish the broadcast to the given room")
					.build(),
				glib::ParamSpecString::builder("broadcast")
					.nick("Broadcast")
					.blurb("Publish the broadcast with the given name")
					.build(),
				glib::ParamSpecBoolean::builder("tls-disable-verify")
					.nick("TLS disable verify")
					.blurb("Disable TLS verification")
					.default_value(false)
					.build(),
			]
		});
		PROPERTIES.as_ref()
	}

	fn set_property(&self, _id: usize, value: &glib::Value, pspec: &glib::ParamSpec) {
		let mut settings = self.settings.lock().unwrap();

		match pspec.name() {
			"url" => settings.url = Some(value.get().unwrap()),
			"broadcast" => settings.broadcast = value.get().unwrap(),
			"room" => settings.room = value.get().unwrap(),
			"tls-disable-verify" => settings.tls_disable_verify = value.get().unwrap(),
			_ => unimplemented!(),
		}
	}

	fn property(&self, _id: usize, pspec: &glib::ParamSpec) -> glib::Value {
		let settings = self.settings.lock().unwrap();

		match pspec.name() {
			"url" => settings.url.to_value(),
			"broadcast" => settings.broadcast.to_value(),
			"room" => settings.room.to_value(),
			"tls-disable-verify" => settings.tls_disable_verify.to_value(),
			_ => unimplemented!(),
		}
	}
}

impl GstObjectImpl for MoqSink {}

impl ElementImpl for MoqSink {
	fn metadata() -> Option<&'static gst::subclass::ElementMetadata> {
		static ELEMENT_METADATA: Lazy<gst::subclass::ElementMetadata> = Lazy::new(|| {
			gst::subclass::ElementMetadata::new(
				"MoQ Sink",
				"Sink",
				"Transmits media over the network via MoQ",
				"Luke Curley <kixelated@gmail.com>",
			)
		});

		Some(&*ELEMENT_METADATA)
	}

	fn pad_templates() -> &'static [gst::PadTemplate] {
		static PAD_TEMPLATES: Lazy<Vec<gst::PadTemplate>> = Lazy::new(|| {
			let caps = gst::Caps::builder("video/quicktime")
				.field("variant", "iso-fragmented")
				.build();

			let pad_template =
				gst::PadTemplate::new("sink", gst::PadDirection::Sink, gst::PadPresence::Always, &caps).unwrap();

			vec![pad_template]
		});
		PAD_TEMPLATES.as_ref()
	}
}

impl BaseSinkImpl for MoqSink {
	fn start(&self) -> Result<(), gst::ErrorMessage> {
		let _guard = RUNTIME.enter();
		self.setup()
			.map_err(|e| gst::error_msg!(gst::ResourceError::Failed, ["Failed to connect: {}", e]))
	}

	fn stop(&self) -> Result<(), gst::ErrorMessage> {
		Ok(())
	}

	fn render(&self, buffer: &gst::Buffer) -> Result<gst::FlowSuccess, gst::FlowError> {
		let _guard = RUNTIME.enter();
		let data = buffer.map_readable().map_err(|_| gst::FlowError::Error)?;

		let mut state = self.state.lock().unwrap();
		let mut media = state.media.take().expect("not initialized");

		// TODO avoid full media parsing? gst should be able to provide the necessary info
		media.parse(data.as_slice()).expect("failed to parse");
		state.media = Some(media);

		Ok(gst::FlowSuccess::Ok)
	}
}

impl MoqSink {
	fn setup(&self) -> anyhow::Result<()> {
		let settings = self.settings.lock().unwrap();
		let url = settings.url.clone().context("missing url")?;
		let url = url.parse().context("invalid URL")?;

		// TODO support TLS certs and other options
		let config = quic::Args {
			bind: "[::]:0".parse().unwrap(),
			tls: tls::Args {
				disable_verify: settings.tls_disable_verify,
				..Default::default()
			},
		}
		.load()?;
		let client = quic::Endpoint::new(config)?.client;

		let room = settings.room.clone();
		let broadcast = settings.broadcast.clone();

		RUNTIME.block_on(async move {
			let session = client.connect(&url).await.expect("failed to connect");
			let session = moq_transfork::Session::connect(session)
				.await
				.expect("failed to connect");

			let broadcast = moq_karp::Room::new(session, room).publish(&broadcast).unwrap();
			let media = moq_karp::cmaf::Import::new(broadcast);

			let mut state = self.state.lock().unwrap();
			state.media = Some(media);
		});

		Ok(())
	}
}
