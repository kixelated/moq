use std::{
	net,
	pin::Pin,
	sync::Arc,
	task::{ready, Context, Poll},
};

use axum::{
	body::Body,
	extract::{ws::WebSocket, Path, Query, State, WebSocketUpgrade},
	http::{Method, StatusCode},
	response::{IntoResponse, Response},
	routing::{any, get},
	Router,
};
use bytes::Bytes;
use clap::Parser;
use hyper_serve::accept::DefaultAcceptor;
use moq_lite::{OriginConsumer, OriginProducer};
use serde::{Deserialize, Serialize};
use std::future::Future;
use tower_http::cors::{Any, CorsLayer};

use crate::{Auth, Cluster};

#[derive(Debug, Deserialize)]
struct Params {
	jwt: Option<String>,
}

#[derive(Parser, Clone, Default, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct WebConfig {
	/// Listen for HTTP and WebSocket connections on the given address.
	/// Defaults to disabled if not provided.
	#[arg(long = "web-bind", env = "MOQ_WEB_BIND")]
	pub bind: Option<net::SocketAddr>,
}

pub struct WebState {
	pub auth: Auth,
	pub cluster: Cluster,
	pub fingerprints: Vec<String>,
	pub config: WebConfig,
}

// Run a HTTP server using Axum
pub struct Web {
	app: Router,
	server: hyper_serve::Server<DefaultAcceptor>,
}

impl Web {
	pub fn new(state: WebState) -> Self {
		// Get the first certificate's fingerprint.
		// TODO serve all of them so we can support multiple signature algorithms.
		let fingerprint = state.fingerprints.first().expect("missing certificate").clone();
		let bind = state.config.bind.unwrap_or("[::]:443".parse().unwrap());

		let app = Router::new()
			.route("/certificate.sha256", get(fingerprint))
			.route("/announced", get(serve_announced))
			.route("/announced/{*prefix}", get(serve_announced))
			.route("/fetch/{*path}", get(serve_fetch))
			.route("/ws/{*path}", any(serve_ws))
			.layer(CorsLayer::new().allow_origin(Any).allow_methods([Method::GET]))
			.with_state(Arc::new(state));

		let server = hyper_serve::bind(bind);

		Self { app, server }
	}

	pub async fn run(self) -> anyhow::Result<()> {
		self.server.serve(self.app.into_make_service()).await?;
		Ok(())
	}
}

async fn serve_ws(
	ws: WebSocketUpgrade,
	Path(path): Path<String>,
	Query(params): Query<Params>,
	State(state): State<Arc<WebState>>,
) -> axum::response::Result<Response> {
	let token = state.auth.verify(&path, params.jwt.as_deref())?;
	let publish = state.cluster.publisher(&token);
	let subscribe = state.cluster.subscriber(&token);

	if publish.is_none() && subscribe.is_none() {
		// Bad token, we can't publish or subscribe.
		return Err(StatusCode::UNAUTHORIZED.into());
	}

	Ok(ws.on_upgrade(move |socket| handle_socket(socket, publish, subscribe)))
}

async fn handle_socket(mut socket: WebSocket, publish: Option<OriginProducer>, subscribe: Option<OriginConsumer>) {
	// Wrap the WebSocket in a WebTransport compatibility layer.
	let ws = web_transport_axum::new(socket);

	let session = moq_lite::Session::connect(ws, publish, subscribe).await?;
	session.closed().await;
}

/// Serve the announced broadcasts for a given prefix.
async fn serve_announced(
	Path(prefix): Path<String>,
	Query(params): Query<Params>,
	State(state): State<Arc<WebState>>,
) -> axum::response::Result<String> {
	let token = state.auth.verify(&prefix, params.jwt.as_deref())?;
	let mut origin = match state.cluster.subscriber(&token) {
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
async fn serve_fetch(
	Path(path): Path<String>,
	Query(params): Query<Params>,
	State(state): State<Arc<WebState>>,
) -> axum::response::Result<ServeGroup> {
	// The path containts a broadcast/track
	let mut path: Vec<&str> = path.split("/").collect();
	let track = path.pop().unwrap().to_string();

	// We need at least a broadcast and a track.
	if path.is_empty() {
		return Err(StatusCode::BAD_REQUEST.into());
	}

	let broadcast = path.join("/");
	let token = state.auth.verify(&broadcast, params.jwt.as_deref())?;

	let origin = match state.cluster.subscriber(&token) {
		Some(origin) => origin,
		None => return Err(StatusCode::UNAUTHORIZED.into()),
	};

	tracing::info!(%broadcast, %track, "subscribing to track");

	let track = moq_lite::Track {
		name: track,
		priority: 0,
	};

	let broadcast = origin.consume_broadcast(&broadcast).ok_or(StatusCode::NOT_FOUND)?;
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
