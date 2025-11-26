use std::env;
use std::fs;
use std::path::PathBuf;

const LIB_NAME: &str = "hang";

fn main() {
	let crate_dir = env::var("CARGO_MANIFEST_DIR").unwrap();
	let version = env::var("CARGO_PKG_VERSION").unwrap();

	// Generate C header
	let header = target_dir().join(format!("{}.h", LIB_NAME));
	cbindgen::Builder::new()
		.with_crate(&crate_dir)
		.with_language(cbindgen::Language::C)
		.generate()
		.expect("Unable to generate bindings")
		.write_to_file(&header);

	// Generate pkg-config file
	let pc_in = PathBuf::from(&crate_dir).join(format!("{}.pc.in", LIB_NAME));
	let pc_out = target_dir().parent().unwrap().join(format!("{}.pc", LIB_NAME));
	if let Ok(template) = fs::read_to_string(&pc_in) {
		let content = template
			.replace("@PREFIX@", "/usr/local")
			.replace("@VERSION@", &version);
		fs::write(&pc_out, content).expect("Failed to write pkg-config file");
	}
}

fn target_dir() -> PathBuf {
	if let Ok(target) = env::var("CARGO_TARGET_DIR") {
		PathBuf::from(target)
	} else {
		PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap())
			.join("target")
			.join("include")
	}
}
