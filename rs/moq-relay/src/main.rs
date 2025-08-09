mod auth;
mod cluster;
mod config;
mod connection;
mod web;

pub use auth::*;
pub use cluster::*;
pub use config::*;
pub use connection::*;
pub use web::*;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
	let config = Config::load()?;

	let addr = config.server.listen.unwrap_or("[::]:443".parse().unwrap());
	let mut server = config.server.init()?;
	let client = config.client.init()?;
	let auth = config.auth.init()?;
	let fingerprints = server.fingerprints().to_vec();

	let cluster = Cluster::new(config.cluster, client);
	let cloned = cluster.clone();
	tokio::spawn(async move { cloned.run().await.expect("cluster failed") });

	// Create a web server too.
	let web = Web::new(WebConfig {
		bind: addr,
		fingerprints,
		cluster: cluster.clone(),
	});

	tokio::spawn(async move {
		web.run().await.expect("failed to run web server");
	});

	tracing::info!(%addr, "listening");

	let mut conn_id = 0;

	while let Some(request) = server.accept().await {
		let conn = Connection {
			id: conn_id,
			request,
			cluster: cluster.clone(),
			auth: auth.clone(),
		};

		conn_id += 1;
		tokio::spawn(async move {
			let err = conn.run().await;
			if let Err(err) = err {
				tracing::warn!(%err, "connection closed");
			}
		});
	}

	Ok(())
}
