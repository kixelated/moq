use anyhow::Context;
use axum::handler::HandlerWithoutStateExt;
use axum::http::StatusCode;
use axum::response::IntoResponse;
use axum::{http::Method, routing::get, Router};
use hang::{cmaf, moq_lite};
use hang::{BroadcastConsumer, BroadcastProducer};
use moq_lite::web_transport;
use std::net::SocketAddr;
use std::path::PathBuf;
use tokio::io::AsyncRead;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;

pub async fn server<T: AsyncRead + Unpin>(
	config: moq_native::ServerConfig,
	name: String,
	public: Option<PathBuf>,
	input: &mut T,
) -> anyhow::Result<()> {
	let mut listen = config.listen.unwrap_or("[::]:443".parse().unwrap());
	listen = tokio::net::lookup_host(listen)
		.await
		.context("invalid listen address")?
		.next()
		.context("invalid listen address")?;

	let server = config.init()?;
	let fingerprints = server.fingerprints().to_vec();

	let producer = BroadcastProducer::new();
	let consumer = producer.consume();

	tokio::select! {
		res = accept(server, name, consumer) => res,
		res = publish(producer, input) => res,
		res = web(listen, fingerprints, public) => res,
	}
}

async fn accept(mut server: moq_native::Server, name: String, consumer: BroadcastConsumer) -> anyhow::Result<()> {
	let mut conn_id = 0;

	tracing::info!(addr = ?server.local_addr(), "listening");

	while let Some(session) = server.accept().await {
		let id = conn_id;
		conn_id += 1;

		let consumer = consumer.clone();
		let name = name.clone();

		// Handle the connection in a new task.
		tokio::spawn(async move {
			if let Err(err) = run_session(id, session, name, consumer).await {
				tracing::warn!(%err, "failed to accept session");
			}
		});
	}

	Ok(())
}

#[tracing::instrument("session", skip_all, fields(id))]
async fn run_session(
	id: u64,
	session: web_transport::quinn::Request,
	name: String,
	consumer: BroadcastConsumer,
) -> anyhow::Result<()> {
	// Blindly accept the WebTransport session, regardless of the URL.
	let session = session.ok().await.context("failed to accept session")?;

	// Create an origin producer to publish to the broadcast.
	let mut publisher = moq_lite::OriginProducer::default();
	publisher.publish(&name, consumer.inner.clone());

	let session = moq_lite::Session::accept(session, publisher.consume_all(), None)
		.await
		.context("failed to accept session")?;

	tracing::info!(id, "accepted session");

	Err(session.closed().await.into())
}

async fn publish<T: AsyncRead + Unpin>(producer: BroadcastProducer, input: &mut T) -> anyhow::Result<()> {
	let mut import = cmaf::Import::new(producer);

	import
		.init_from(input)
		.await
		.context("failed to initialize cmaf from input")?;

	tracing::info!("initialized");

	import.read_from(input).await?;

	Ok(())
}

// Run a HTTP server using Axum to serve the certificate fingerprint.
async fn web(bind: SocketAddr, fingerprints: Vec<String>, public: Option<PathBuf>) -> anyhow::Result<()> {
	// Get the first certificate's fingerprint.
	// TODO serve all of them so we can support multiple signature algorithms.
	let fingerprint = fingerprints.first().expect("missing certificate").clone();

	async fn handle_404() -> impl IntoResponse {
		(StatusCode::NOT_FOUND, "Not found")
	}

	let mut app = Router::new()
		.route("/certificate.sha256", get(fingerprint))
		.layer(CorsLayer::new().allow_origin(Any).allow_methods([Method::GET]));

	// If a public directory is provided, serve it.
	// We use this for local development to serve the index.html file and friends.
	if let Some(public) = public.as_ref() {
		tracing::info!(public = %public.display(), "serving directory");

		let public = ServeDir::new(public).not_found_service(handle_404.into_service());
		app = app.fallback_service(public);
	} else {
		app = app.fallback_service(handle_404.into_service());
	}

	let server = hyper_serve::bind(bind);
	server.serve(app.into_make_service()).await?;

	Ok(())
}
