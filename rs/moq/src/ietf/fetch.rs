pub struct Fetch {}
impl Fetch {
	pub const ID: u64 = 0x16;
}

pub struct FetchOk {}
impl FetchOk {
	pub const ID: u64 = 0x18;
}

pub struct FetchError {}

impl FetchError {
	pub const ID: u64 = 0x19;
}

pub struct FetchCancel {}
impl FetchCancel {
	pub const ID: u64 = 0x17;
}
