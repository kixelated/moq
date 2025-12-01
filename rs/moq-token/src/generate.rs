#[cfg(feature = "jwk-ec")]
use crate::EllipticCurve;
#[cfg(feature = "jwk-rsa")]
use crate::RsaPublicKey;
use crate::{Algorithm, Key, KeyOperation, JWK};
#[cfg(feature = "jwk-ec")]
use elliptic_curve::sec1::ToEncodedPoint;
#[cfg(feature = "jwk-rsa")]
use rsa::traits::{PrivateKeyParts, PublicKeyParts};

/// Generate a key pair for the given algorithm, returning the private and public keys.
pub fn generate(algorithm: Algorithm, id: Option<String>) -> anyhow::Result<JWK> {
	let key = match algorithm {
		Algorithm::HS256 => Ok(generate_hmac_key::<32>()),
		Algorithm::HS384 => Ok(generate_hmac_key::<48>()),
		Algorithm::HS512 => Ok(generate_hmac_key::<64>()),
		#[cfg(feature = "jwk-rsa")]
		Algorithm::RS256 | Algorithm::RS384 | Algorithm::RS512 => generate_rsa_key(2048),
		#[cfg(feature = "jwk-ec")]
		Algorithm::ES256 => Ok(generate_ec_key(EllipticCurve::P256)),
		#[cfg(feature = "jwk-ec")]
		Algorithm::ES384 => Ok(generate_ec_key(EllipticCurve::P384)),
		#[cfg(feature = "jwk-rsa")]
		Algorithm::PS256 | Algorithm::PS384 | Algorithm::PS512 => generate_rsa_key(2048),
		// Algorithm::EdDSA => generate_ed25519_key(),
	};

	match key {
		Ok(key) => Ok(JWK {
			kid: id,
			operations: [KeyOperation::Sign, KeyOperation::Verify].into(),
			algorithm,
			key,
			decode: Default::default(),
			encode: Default::default(),
		}),
		Err(e) => Err(e),
	}
}

fn generate_hmac_key<const SIZE: usize>() -> Key {
	let mut key = [0u8; SIZE];
	aws_lc_rs::rand::fill(&mut key).unwrap();
	Key::OCT { secret: key.to_vec() }
}

#[cfg(feature = "jwk-rsa")]
struct AwsRng;

#[cfg(feature = "jwk-rsa")]
impl rsa::rand_core::RngCore for AwsRng {
	fn next_u32(&mut self) -> u32 {
		let mut buf = [0u8; 4];
		self.fill_bytes(&mut buf);
		u32::from_le_bytes(buf)
	}

	fn next_u64(&mut self) -> u64 {
		let mut buf = [0u8; 8];
		self.fill_bytes(&mut buf);
		u64::from_le_bytes(buf)
	}

	fn fill_bytes(&mut self, dest: &mut [u8]) {
		aws_lc_rs::rand::fill(dest).unwrap();
	}

	fn try_fill_bytes(&mut self, dest: &mut [u8]) -> Result<(), rsa::rand_core::Error> {
		aws_lc_rs::rand::fill(dest).map_err(|_| rsa::rand_core::Error::new("aws-lc-rs failed"))
	}
}

#[cfg(feature = "jwk-rsa")]
impl rsa::rand_core::CryptoRng for AwsRng {}

#[cfg(feature = "jwk-rsa")]
fn generate_rsa_key(size: usize) -> anyhow::Result<Key> {
	let mut rng = AwsRng;
	let key = rsa::RsaPrivateKey::new(&mut rng, size);

	match key {
		Ok(key) => Ok(Key::RSA {
			public: RsaPublicKey {
				exponent: key.e().to_bytes_be(),
				modulus: key.n().to_bytes_be(),
			},
			private: Some(crate::RsaPrivateKey {
				exponent: key.d().to_bytes_be(),
				first_prime: key.primes()[0].to_bytes_be(),
				second_prime: key.primes()[1].to_bytes_be(),
			}),
		}),
		Err(err) => Err(anyhow::anyhow!("Failed to generate RSA key: {}", err)),
	}
}

#[cfg(feature = "jwk-ec")]
fn generate_ec_key(curve: EllipticCurve) -> Key {
	let (x, y, d) = match curve {
		EllipticCurve::P256 => {
			let mut bytes = [0u8; 32];
			let secret = loop {
				aws_lc_rs::rand::fill(&mut bytes).unwrap();
				if let Ok(s) = p256::SecretKey::from_slice(&bytes) {
					break s;
				}
			};

			let public = secret.public_key();
			let point = public.to_encoded_point(false);

			let x = point.x().unwrap().to_vec();
			let y = point.y().unwrap().to_vec();
			let d = secret.to_bytes().to_vec();
			(x, y, d)
		}
		EllipticCurve::P384 => {
			let mut bytes = [0u8; 48];
			let secret = loop {
				aws_lc_rs::rand::fill(&mut bytes).unwrap();
				if let Ok(s) = p384::SecretKey::from_slice(&bytes) {
					break s;
				}
			};

			let public = secret.public_key();
			let point = public.to_encoded_point(false);

			let x = point.x().unwrap().to_vec();
			let y = point.y().unwrap().to_vec();
			let d = secret.to_bytes().to_vec();
			(x, y, d)
		}
	};

	Key::EC {
		curve,
		x,
		y,
		d: Some(d),
	}
}

/*
fn generate_ed25519_key() -> (Vec<u8>, Vec<u8>) {
	let key = signature::Ed25519KeyPair::generate().unwrap();
	let private_key: Pkcs8V1Der = key.as_der().unwrap();
	let private_key = private_key.as_ref().to_vec();
	let public_key = key.public_key().as_der().unwrap().as_ref().to_vec();

	(private_key, public_key)
}
*/
