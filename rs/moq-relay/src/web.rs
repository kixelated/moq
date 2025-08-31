use std::{
	fs,
	io::{self, Cursor, Read},
	path::PathBuf,
	pin::Pin,
	sync::Arc,
	task::{ready, Context, Poll},
};

use anyhow::Context as _;
use axum::{
	body::Body,
	extract::Path,
	http::{Method, StatusCode},
	response::{IntoResponse, Response},
	routing::get,
	Router,
};
use bytes::Bytes;
use hyper_serve::accept::DefaultAcceptor;
use rustls::pki_types::CertificateDer;
use std::future::Future;
use tower_http::cors::{Any, CorsLayer};

use crate::{Cluster, HttpConfig, HttpsConfig};

pub struct WebConfig {
	pub http: HttpConfig,
	pub https: HttpsConfig,
	pub fingerprints: Vec<String>,
	pub cluster: Cluster,
}

// Run a HTTP/HTTPS server using Axum
// TODO remove HTTP when Chrome adds support for self-signed certificates using WebTransport
pub struct Web {
	app: Router,
	server: Option<hyper_serve::Server<DefaultAcceptor>>,
	server_https: Option<hyper_serve::Server<hyper_serve::tls_rustls::RustlsAcceptor>>,
}

impl Web {
	pub fn new(config: WebConfig) -> anyhow::Result<Self> {
		// Check if we have at least one server configured
		if config.http.bind.is_none() && config.https.bind.is_none() {
			return Ok(Self {
				app: Router::new(),
				server: None,
				server_https: None,
			});
		}

		// Get the first certificate's fingerprint.
		// TODO serve all of them so we can support multiple signature algorithms.
		let fingerprint = config.fingerprints.first().expect("missing certificate").clone();

		let app = Router::new()
			.route("/certificate.sha256", get(fingerprint))
			.route(
				"/announced",
				get({
					let cluster = config.cluster.clone();
					move || serve_announced(Path("".to_string()), cluster.clone())
				}),
			)
			.route(
				"/announced/{*prefix}",
				get({
					let cluster = config.cluster.clone();
					move |path| serve_announced(path, cluster)
				}),
			)
			.route(
				"/fetch/{*path}",
				get({
					let cluster = config.cluster.clone();
					move |path| serve_fetch(path, cluster)
				}),
			)
			.layer(CorsLayer::new().allow_origin(Any).allow_methods([Method::GET]));

		// Set up HTTP server if configured
		let server = config.http.bind.map(|bind| hyper_serve::bind(bind));

		// Set up HTTPS server if configured
		let server_https = match (config.https.bind, config.https.cert, config.https.key) {
			(Some(bind), Some(cert_path), Some(key_path)) => {
				let tls_config = Self::load_tls_config(&cert_path, &key_path)?;
				let rustls_config = hyper_serve::tls_rustls::RustlsConfig::from_config(tls_config);
				Some(hyper_serve::bind_rustls(bind, rustls_config))
			}
			(Some(_), _, _) => {
				anyhow::bail!("HTTPS bind address provided but missing cert or key")
			}
			_ => None,
		};

		Ok(Self { app, server, server_https })
	}

	pub async fn run(self) -> anyhow::Result<()> {
		// If no servers are configured, return immediately
		if self.server.is_none() && self.server_https.is_none() {
			tracing::info!("No HTTP or HTTPS server configured, skipping web server");
			return Ok(());
		}

		let app = self.app.into_make_service();

		match (self.server, self.server_https) {
			(Some(http), Some(https)) => {
				tracing::info!("Starting HTTP and HTTPS servers");
				// Run both HTTP and HTTPS servers concurrently
				tokio::select! {
					res = http.serve(app.clone()) => res?,
					res = https.serve(app) => res?,
				}
			}
			(Some(http), None) => {
				tracing::info!("Starting HTTP server");
				// Run only HTTP server
				http.serve(app).await?;
			}
			(None, Some(https)) => {
				tracing::info!("Starting HTTPS server");
				// Run only HTTPS server
				https.serve(app).await?;
			}
			(None, None) => unreachable!("already checked above"),
		}

		Ok(())
	}

	fn load_tls_config(cert_path: &PathBuf, key_path: &PathBuf) -> anyhow::Result<Arc<rustls::ServerConfig>> {
		// Load certificate chain
		let cert_file = fs::File::open(cert_path).context("failed to open certificate file")?;
		let mut cert_reader = io::BufReader::new(cert_file);
		let certs: Vec<CertificateDer> = rustls_pemfile::certs(&mut cert_reader)
			.collect::<Result<_, _>>()
			.context("failed to read certificates")?;
		anyhow::ensure!(!certs.is_empty(), "no certificates found in file");

		// Load private key
		let mut key_file = fs::File::open(key_path).context("failed to open key file")?;
		let mut key_bytes = Vec::new();
		key_file.read_to_end(&mut key_bytes)?;
		let key = rustls_pemfile::private_key(&mut Cursor::new(&key_bytes))?
			.context("missing private key")?;

		// Build TLS config
		let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
		let config = rustls::ServerConfig::builder_with_provider(provider)
			.with_protocol_versions(&[&rustls::version::TLS13, &rustls::version::TLS12])?
			.with_no_client_auth()
			.with_single_cert(certs, key)
			.context("failed to create TLS config")?;

		Ok(Arc::new(config))
	}
}

/// Serve the announced broadcasts for a given prefix.
async fn serve_announced(Path(prefix): Path<String>, cluster: Cluster) -> axum::response::Result<String> {
	let mut origin = match cluster.combined.consumer.consume_only(&[prefix.into()]) {
		Some(origin) => origin,
		None => return Err(StatusCode::UNAUTHORIZED.into()),
	};

	let mut broadcasts = Vec::new();

	while let Some((suffix, active)) = origin.try_announced() {
		if active.is_some() {
			broadcasts.push(suffix);
		}
	}

	Ok(broadcasts.iter().map(|p| p.to_string()).collect::<Vec<_>>().join("\n"))
}

/// Serve the latest group for a given track
async fn serve_fetch(Path(path): Path<String>, cluster: Cluster) -> axum::response::Result<ServeGroup> {
	let mut path: Vec<&str> = path.split("/").collect();
	if path.len() < 2 {
		return Err(StatusCode::BAD_REQUEST.into());
	}

	let track = path.pop().unwrap().to_string();
	let broadcast = path.join("/");

	tracing::info!(%broadcast, %track, "subscribing to track");

	let track = moq_lite::Track {
		name: track,
		priority: 0,
	};

	let broadcast = cluster.get(&broadcast).ok_or(StatusCode::NOT_FOUND)?;
	let mut track = broadcast.subscribe_track(&track);

	let group = match track.next_group().await {
		Ok(Some(group)) => group,
		Ok(None) => return Err(StatusCode::NOT_FOUND.into()),
		Err(_) => return Err(StatusCode::INTERNAL_SERVER_ERROR.into()),
	};

	Ok(ServeGroup::new(group))
}

struct ServeGroup {
	group: moq_lite::GroupConsumer,
	frame: Option<moq_lite::FrameConsumer>,
}

impl ServeGroup {
	fn new(group: moq_lite::GroupConsumer) -> Self {
		Self { group, frame: None }
	}

	async fn next(&mut self) -> moq_lite::Result<Option<Bytes>> {
		loop {
			if let Some(frame) = self.frame.as_mut() {
				let data = frame.read_all().await?;
				self.frame.take();
				return Ok(Some(data));
			}

			self.frame = self.group.next_frame().await?;
			if self.frame.is_none() {
				return Ok(None);
			}
		}
	}
}

impl IntoResponse for ServeGroup {
	fn into_response(self) -> Response {
		Response::new(Body::new(self))
	}
}

impl http_body::Body for ServeGroup {
	type Data = Bytes;
	type Error = ServeGroupError;

	fn poll_frame(
		self: Pin<&mut Self>,
		cx: &mut Context<'_>,
	) -> Poll<Option<Result<http_body::Frame<Self::Data>, Self::Error>>> {
		let this = self.get_mut();

		// Use `poll_fn` to turn the async function into a Future
		let future = this.next();
		tokio::pin!(future);

		match ready!(future.poll(cx)) {
			Ok(Some(data)) => {
				let frame = http_body::Frame::data(data);
				Poll::Ready(Some(Ok(frame)))
			}
			Ok(None) => Poll::Ready(None),
			Err(e) => Poll::Ready(Some(Err(ServeGroupError(e)))),
		}
	}
}

#[derive(Debug, thiserror::Error)]
#[error(transparent)]
struct ServeGroupError(moq_lite::Error);

impl IntoResponse for ServeGroupError {
	fn into_response(self) -> Response {
		(StatusCode::INTERNAL_SERVER_ERROR, self.0.to_string()).into_response()
	}
}
