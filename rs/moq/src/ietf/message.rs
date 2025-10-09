use crate::coding::{Decode, DecodeError, Encode};

pub enum MessageId {
	SubscribeUpdate,
	Subscribe,
	SubscribeOk,
	SubscribeError,
	Announce,
	AnnounceOk,
	AnnounceError,
	Unannounce,
	Unsubscribe,
	SubscribeDone,
	AnnounceCancel,
	TrackStatusRequest,
	TrackStatus,
	GoAway,
	SubscribeAnnounces,
	SubscribeAnnouncesOk,
	SubscribeAnnouncesError,
	UnsubscribeAnnounces,
	MaxSubscribeId,
	Fetch,
	FetchCancel,
	FetchOk,
	FetchError,
	ClientSetup,
	ServerSetup,
}

/*
0x2	SUBSCRIBE_UPDATE (Section 6.5)
0x3	SUBSCRIBE (Section 6.4)
0x4	SUBSCRIBE_OK (Section 6.15)
0x5	SUBSCRIBE_ERROR (Section 6.16)
0x6	ANNOUNCE (Section 6.21)
0x7	ANNOUNCE_OK (Section 6.9)
0x8	ANNOUNCE_ERROR (Section 6.10)
0x9	UNANNOUNCE (Section 6.22)
0xA	UNSUBSCRIBE (Section 6.6)
0xB	SUBSCRIBE_DONE (Section 6.19)
0xC	ANNOUNCE_CANCEL (Section 6.11)
0xD	TRACK_STATUS_REQUEST (Section 6.12)
0xE	TRACK_STATUS (Section 6.23)
0x10	GOAWAY (Section 6.3)
0x11	SUBSCRIBE_ANNOUNCES (Section 6.13)
0x12	SUBSCRIBE_ANNOUNCES_OK (Section 6.24)
0x13	SUBSCRIBE_ANNOUNCES_ERROR (Section 6.25
0x14	UNSUBSCRIBE_ANNOUNCES (Section 6.14)
0x15	MAX_SUBSCRIBE_ID (Section 6.20)
0x16	FETCH (Section 6.7)
0x17	FETCH_CANCEL (Section 6.8)
0x18	FETCH_OK (Section 6.17)
0x19	FETCH_ERROR (Section 6.18)
0x40	CLIENT_SETUP (Section 6.2)
0x41	SERVER_SETUP (Section 6.2)
*/

impl Encode for MessageId {
	fn encode<W: bytes::BufMut>(&self, w: &mut W) {
		let id: u64 = match self {
			Self::SubscribeUpdate => 0x02,
			Self::Subscribe => 0x03,
			Self::SubscribeOk => 0x04,
			Self::SubscribeError => 0x05,
			Self::Announce => 0x06,
			Self::AnnounceOk => 0x07,
			Self::AnnounceError => 0x08,
			Self::Unannounce => 0x09,
			Self::Unsubscribe => 0x0A,
			Self::SubscribeDone => 0x0B,
			Self::AnnounceCancel => 0x0C,
			Self::TrackStatusRequest => 0x0D,
			Self::TrackStatus => 0x0E,
			Self::GoAway => 0x10,
			Self::SubscribeAnnounces => 0x11,
			Self::SubscribeAnnouncesOk => 0x12,
			Self::SubscribeAnnouncesError => 0x13,
			Self::UnsubscribeAnnounces => 0x14,
			Self::MaxSubscribeId => 0x15,
			Self::Fetch => 0x16,
			Self::FetchCancel => 0x17,
			Self::FetchOk => 0x18,
			Self::FetchError => 0x19,
			Self::ClientSetup => 0x40,
			Self::ServerSetup => 0x41,
		};
		id.encode(w)
	}
}

impl Decode for MessageId {
	fn decode<R: bytes::Buf>(r: &mut R) -> Result<Self, DecodeError> {
		let id = u64::decode(r)?;
		Ok(match id {
			0x02 => Self::SubscribeUpdate,
			0x03 => Self::Subscribe,
			0x04 => Self::SubscribeOk,
			0x05 => Self::SubscribeError,
			0x06 => Self::Announce,
			0x07 => Self::AnnounceOk,
			0x08 => Self::AnnounceError,
			0x09 => Self::Unannounce,
			0x0A => Self::Unsubscribe,
			0x0B => Self::SubscribeDone,
			0x0C => Self::AnnounceCancel,
			0x0D => Self::TrackStatusRequest,
			0x0E => Self::TrackStatus,
			0x10 => Self::GoAway,
			0x11 => Self::SubscribeAnnounces,
			0x12 => Self::SubscribeAnnouncesOk,
			0x13 => Self::SubscribeAnnouncesError,
			0x14 => Self::UnsubscribeAnnounces,
			0x15 => Self::MaxSubscribeId,
			0x16 => Self::Fetch,
			0x17 => Self::FetchCancel,
			0x18 => Self::FetchOk,
			0x19 => Self::FetchError,
			0x40 => Self::ClientSetup,
			0x41 => Self::ServerSetup,
			_ => return Err(DecodeError::InvalidValue),
		})
	}
}
