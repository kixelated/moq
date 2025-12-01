use crate::{Algorithm, Key, KeyOperation, JWK};
#[cfg(feature = "jwk-ec")]
use elliptic_curve::sec1::ToEncodedPoint;
#[cfg(feature = "jwk-ec")]
use crate::EcCurve;
#[cfg(feature = "jwk-rsa")]
use crate::RsaPublicKey;
#[cfg(feature = "jwk-rsa")]
use rand::thread_rng;
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
        Algorithm::ES256 => Ok(generate_ec_key(EcCurve::P256)),
        #[cfg(feature = "jwk-ec")]
        Algorithm::ES384 => Ok(generate_ec_key(EcCurve::P384)),
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
fn generate_rsa_key(size: usize) -> anyhow::Result<Key> {
    let mut rng = thread_rng();
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
fn generate_ec_key(curve: EcCurve) -> Key {
    let (x, y, d) = match curve {
        EcCurve::P256 => {
            let secret = p256::SecretKey::random(&mut rand::thread_rng());
            let public = secret.public_key();
            let point = public.to_encoded_point(false);

            let x = point.x().unwrap().to_vec();
            let y = point.y().unwrap().to_vec();
            let d = secret.to_bytes().to_vec();
            (x, y, d)
        }
        EcCurve::P384 => {
            let secret = p384::SecretKey::random(&mut rand::thread_rng());
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
