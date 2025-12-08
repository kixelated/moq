use std::env;
use std::fs;
use std::path::PathBuf;

const LIB_NAME: &str = "moq";

fn main() {
	let crate_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
	let version = env::var("CARGO_PKG_VERSION").unwrap();
	let out_dir = output_dir();

	// Generate C header
	let header = out_dir.join(format!("{}.h", LIB_NAME));
	cbindgen::Builder::new()
		.with_crate(&crate_dir)
		.with_language(cbindgen::Language::C)
		.generate()
		.expect("Unable to generate bindings")
		.write_to_file(&header);

	// Generate pkg-config file
	let pc_in = PathBuf::from(&crate_dir).join(format!("{}.pc.in", LIB_NAME));
	let pc_out = out_dir.join(format!("{}.pc", LIB_NAME));
	if let Ok(template) = fs::read_to_string(&pc_in) {
		let content = template
			.replace("@PREFIX@", "/usr/local")
			.replace("@VERSION@", &version);
		fs::write(&pc_out, content).expect("Failed to write pkg-config file");
	}
}

fn output_dir() -> PathBuf {
	// OUT_DIR is like: target/debug/build/libmoq-xxx/out
	// We want: target/debug/ (where the library is)
	let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
	out_dir
		.parent() // build/libmoq-xxx
		.and_then(|p| p.parent()) // build
		.and_then(|p| p.parent()) // debug
		.map(|p| p.to_path_buf())
		.unwrap_or(out_dir)
}
