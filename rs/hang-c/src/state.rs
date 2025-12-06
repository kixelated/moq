use std::ops::{Deref, DerefMut};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};

use bytes::Buf;
use slab::Slab;
use tokio::sync::watch;
use url::Url;

use crate::{ffi, Error};

#[derive(Default)]
struct SessionStatus {
	connected: bool,
	closed: Option<Error>,
}

struct Session {
	// The collection of published broadcasts.
	origin: moq_lite::OriginProducer,

	// A channel to receive the connection status.
	status: watch::Receiver<SessionStatus>,
}

pub struct State {
	// All sessions by ID.
	sessions: Slab<Session>, // TODO clean these up on error.

	// All broadcasts, indexed by an ID.
	broadcasts: Slab<hang::BroadcastProducer>,

	// All tracks, indexed by an ID.
	tracks: Slab<hang::import::Generic>,
}

pub struct StateGuard {
	_runtime: tokio::runtime::EnterGuard<'static>,
	state: MutexGuard<'static, State>,
}

impl Deref for StateGuard {
	type Target = State;
	fn deref(&self) -> &Self::Target {
		&self.state
	}
}

impl DerefMut for StateGuard {
	fn deref_mut(&mut self) -> &mut Self::Target {
		&mut self.state
	}
}

impl State {
	pub fn lock() -> StateGuard {
		let runtime = RUNTIME.enter();
		let state = STATE.lock().unwrap();
		StateGuard {
			_runtime: runtime,
			state,
		}
	}
}

static RUNTIME: LazyLock<tokio::runtime::Handle> = LazyLock::new(|| {
	let runtime = tokio::runtime::Builder::new_current_thread()
		.enable_all()
		.build()
		.unwrap();
	let handle = runtime.handle().clone();

	std::thread::Builder::new()
		.name("hang-c".into())
		.spawn(move || {
			runtime.block_on(std::future::pending::<()>());
		})
		.expect("failed to spawn runtime thread");

	handle
});

static STATE: LazyLock<Mutex<State>> = LazyLock::new(|| Mutex::new(State::new()));

impl State {
	fn new() -> Self {
		Self {
			sessions: Default::default(),
			broadcasts: Default::default(),
			tracks: Default::default(),
		}
	}

	pub fn session_connect(&mut self, url: Url) -> Result<usize, Error> {
		let origin = moq_lite::Origin::produce();

		// Cancel the connection when removed from the sessions map
		let mut status = watch::channel(SessionStatus::default());

		let id = self.sessions.insert(Session {
			status: status.1,
			origin: origin.producer,
		});

		tokio::spawn(async move {
			let unused = status.0.clone();
			let err = tokio::select! {
				// No more receiver, which means session_close was called.
				_ = unused.closed() => Ok(()),
				// The connection failed.
				res = Self::session_connect_run(url, origin.consumer, &mut status.0) => res,
			}
			.err()
			.unwrap_or(Error::Closed);

			status.0.send_modify(|status| status.closed = Some(err));
		});

		Ok(id)
	}

	async fn session_connect_run(
		url: Url,
		origin: moq_lite::OriginConsumer,
		status: &mut watch::Sender<SessionStatus>,
	) -> Result<(), Error> {
		let config = moq_native::ClientConfig::default();
		let client = config.init().map_err(|err| Error::Connect(Arc::new(err)))?;
		let connection = client.connect(url).await.map_err(|err| Error::Connect(Arc::new(err)))?;
		let session = moq_lite::Session::connect(connection, origin, None).await?;
		status.send_modify(|status| status.connected = true);

		session.closed().await?;
		Ok(())
	}

	pub fn session_on_connect(&mut self, id: usize, mut callback: ffi::Callback) -> Result<(), Error> {
		let session = self.sessions.get_mut(id).ok_or(Error::NotFound)?;
		let mut status = session.status.clone();

		tokio::spawn(async move {
			let res = match status
				.wait_for(|status| status.connected || status.closed.is_some())
				.await
			{
				Ok(state) if state.closed.is_some() => Err(state.closed.clone().unwrap()),
				Ok(_) => Ok(()),
				Err(_) => Err(Error::Closed),
			};

			callback.call(res);
		});

		Ok(())
	}

	pub fn session_on_close(&mut self, id: usize, mut callback: ffi::Callback) -> Result<(), Error> {
		let session = self.sessions.get_mut(id).ok_or(Error::NotFound)?;
		let mut status = session.status.clone();

		tokio::spawn(async move {
			let err = match status.wait_for(|status| status.closed.is_some()).await {
				Ok(state) => state.closed.clone().unwrap(),
				Err(_) => Error::Closed,
			};
			callback.call(err);
		});

		Ok(())
	}

	pub fn session_close(&mut self, id: usize) -> Result<(), Error> {
		self.sessions.try_remove(id).ok_or(Error::NotFound)?;
		Ok(())
	}

	pub fn publish_broadcast<P: moq_lite::AsPath>(&mut self, id: usize, session: usize, path: P) -> Result<(), Error> {
		let path = path.as_path();
		let broadcast = self.broadcasts.get_mut(id).ok_or(Error::NotFound)?;
		let session = self.sessions.get_mut(session).ok_or(Error::NotFound)?;

		session.origin.publish_broadcast(path, broadcast.consume());

		Ok(())
	}

	pub fn create_broadcast(&mut self) -> usize {
		let broadcast = moq_lite::Broadcast::produce();
		self.broadcasts.insert(broadcast.producer.into())
	}

	pub fn remove_broadcast(&mut self, id: usize) -> Result<(), Error> {
		self.broadcasts.try_remove(id).ok_or(Error::NotFound)?;
		Ok(())
	}

	pub fn create_track(&mut self, broadcast: usize, format: &str) -> Result<usize, Error> {
		let broadcast = self.broadcasts.get_mut(broadcast).ok_or(Error::NotFound)?;
		let import = hang::import::Generic::new(broadcast.clone(), format).ok_or(Error::UnknownFormat)?;
		let id = self.tracks.insert(import);
		Ok(id)
	}

	pub fn init_track(&mut self, id: usize, mut extra: &[u8]) -> Result<(), Error> {
		let track = self.tracks.get_mut(id).ok_or(Error::NotFound)?;
		track
			.initialize(&mut extra)
			.map_err(|err| Error::InitFailed(Arc::new(err)))?;

		if !extra.is_empty() {
			return Err(Error::ShortDecode);
		}

		Ok(())
	}

	pub fn write_track(&mut self, id: usize, mut data: &[u8], pts: u64) -> Result<(), Error> {
		let track = self.tracks.get_mut(id).ok_or(Error::NotFound)?;

		let pts = hang::Timestamp::from_micros(pts)?;
		track
			.decode(&mut data, Some(pts))
			.map_err(|err| Error::DecodeFailed(Arc::new(err)))?;

		if data.has_remaining() {
			return Err(Error::ShortDecode);
		}

		Ok(())
	}

	pub fn remove_track(&mut self, id: usize) -> Result<(), Error> {
		self.tracks.try_remove(id).ok_or(Error::NotFound)?;
		Ok(())
	}
}
