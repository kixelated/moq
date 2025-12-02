use crate::EllipticCurve;
use crate::RsaPublicKey;
use crate::{Algorithm, Key, KeyOperation, JWK};
use aws_lc_rs::signature::KeyPair;
use elliptic_curve::sec1::ToEncodedPoint;
use rsa::traits::{PrivateKeyParts, PublicKeyParts};

/// Generate a key pair for the given algorithm, returning the private and public keys.
pub fn generate(algorithm: Algorithm, id: Option<String>) -> anyhow::Result<JWK> {
	let key = match algorithm {
		Algorithm::HS256 => Ok(generate_hmac_key::<32>()),
		Algorithm::HS384 => Ok(generate_hmac_key::<48>()),
		Algorithm::HS512 => Ok(generate_hmac_key::<64>()),
		Algorithm::RS256 | Algorithm::RS384 | Algorithm::RS512 => generate_rsa_key(2048),
		Algorithm::ES256 => Ok(generate_ec_key(EllipticCurve::P256)),
		Algorithm::ES384 => Ok(generate_ec_key(EllipticCurve::P384)),
		Algorithm::PS256 | Algorithm::PS384 | Algorithm::PS512 => generate_rsa_key(2048),
		Algorithm::EdDSA => generate_ed25519_key(),
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

struct AwsRng;

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

impl rsa::rand_core::CryptoRng for AwsRng {}

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
		EllipticCurve::Ed25519 => {
			// Ed25519 keys should be generated using generate_ed25519_key instead
			unreachable!("Ed25519 keys must use OKP key type, not EC")
		}
	};

	Key::EC {
		curve,
		x,
		y,
		d: Some(d),
	}
}

fn generate_ed25519_key() -> anyhow::Result<Key> {
	let key_pair = aws_lc_rs::signature::Ed25519KeyPair::generate()?;

	let public_key = key_pair.public_key().as_ref().to_vec();

	Ok(Key::OKP {
		curve: EllipticCurve::Ed25519,
		x: public_key,
		d: Some(key_pair.to_pkcs8v1()?.as_ref().as_ref().into()),
	})
}
