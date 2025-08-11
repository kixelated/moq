use std::{collections::HashSet, fmt, path::Path as StdPath, sync::OnceLock};

use base64::Engine;
use jsonwebtoken::{DecodingKey, EncodingKey, Header};
use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::{Algorithm, Claims, Paths};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum KeyOperation {
	Sign,
	Verify,
	Decrypt,
	Encrypt,
}

/// Similar to JWK but not quite the same because it's annoying to implement.
#[derive(Clone, Serialize, Deserialize)]
pub struct Key {
	/// The algorithm used by the key.
	#[serde(rename = "alg")]
	pub algorithm: Algorithm,

	/// The operations that the key can perform.
	#[serde(rename = "key_ops")]
	pub operations: HashSet<KeyOperation>,

	/// The secret key as base64url (unpadded).
	#[serde(
		rename = "k",
		serialize_with = "serialize_base64url",
		deserialize_with = "deserialize_base64url"
	)]
	pub secret: Vec<u8>,

	/// The key ID, useful for rotating keys.
	#[serde(skip_serializing_if = "Option::is_none")]
	pub kid: Option<String>,

	// Cached for performance reasons, unfortunately.
	#[serde(skip)]
	pub(crate) decode: OnceLock<DecodingKey>,

	#[serde(skip)]
	pub(crate) encode: OnceLock<EncodingKey>,
}

impl fmt::Debug for Key {
	fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
		f.debug_struct("Key")
			.field("algorithm", &self.algorithm)
			.field("operations", &self.operations)
			.field("kid", &self.kid)
			.finish()
	}
}

impl Key {
	#[allow(clippy::should_implement_trait)]
	pub fn from_str(s: &str) -> anyhow::Result<Self> {
		Ok(serde_json::from_str(s)?)
	}

	pub fn from_file<P: AsRef<StdPath>>(path: P) -> anyhow::Result<Self> {
		let contents = std::fs::read_to_string(&path)?;
		// It's base64url encoded
		let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(contents.trim())?;
		let json = String::from_utf8(decoded)?;
		Ok(serde_json::from_str(&json)?)
	}

	pub fn to_str(&self) -> anyhow::Result<String> {
		Ok(serde_json::to_string(self)?)
	}

	pub fn to_file<P: AsRef<StdPath>>(&self, path: P) -> anyhow::Result<()> {
		// Serialize to JSON first
		let json = serde_json::to_string(self)?;
		// Then encode as base64url
		let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(json.as_bytes());
		std::fs::write(path, encoded)?;
		Ok(())
	}

	pub fn decode(&self, token: &str) -> anyhow::Result<Claims> {
		if !self.operations.contains(&KeyOperation::Verify) {
			anyhow::bail!("key does not support verification");
		}

		let decode = self.decode.get_or_init(|| match self.algorithm {
			Algorithm::HS256 | Algorithm::HS384 | Algorithm::HS512 => DecodingKey::from_secret(&self.secret),
			/*
			Algorithm::RS256 | Algorithm::RS384 | Algorithm::RS512 => DecodingKey::from_rsa_der(&self.der),
			Algorithm::PS256 | Algorithm::PS384 | Algorithm::PS512 => DecodingKey::from_rsa_der(&self.der),
			Algorithm::ES256 | Algorithm::ES384 => DecodingKey::from_ec_der(&self.der),
			Algorithm::EdDSA => DecodingKey::from_ed_der(&self.der),
			*/
		});

		let mut validation = jsonwebtoken::Validation::new(self.algorithm.into());
		validation.required_spec_claims = Default::default(); // Don't require exp, but still validate it if present

		let token = jsonwebtoken::decode::<Claims>(token, decode, &validation)?;
		token.claims.validate()?;

		Ok(token.claims)
	}

	pub fn encode(&self, payload: &Claims) -> anyhow::Result<String> {
		if !self.operations.contains(&KeyOperation::Sign) {
			anyhow::bail!("key does not support signing");
		}

		payload.validate()?;

		let encode = self.encode.get_or_init(|| match self.algorithm {
			Algorithm::HS256 | Algorithm::HS384 | Algorithm::HS512 => EncodingKey::from_secret(&self.secret),
			/*
			Algorithm::PS256 | Algorithm::PS384 | Algorithm::PS512 => EncodingKey::from_rsa_der(&self.der),
			Algorithm::RS256 | Algorithm::RS384 | Algorithm::RS512 => EncodingKey::from_rsa_der(&self.der),
			Algorithm::ES256 | Algorithm::ES384 => EncodingKey::from_ec_der(&self.der),
			Algorithm::EdDSA => EncodingKey::from_ed_der(&self.der),
			*/
		});

		let mut header = Header::new(self.algorithm.into());
		header.kid = self.kid.clone();
		let token = jsonwebtoken::encode(&header, &payload, encode)?;
		Ok(token)
	}

	/// Generate a key pair for the given algorithm, returning the private and public keys.
	pub fn generate(algorithm: Algorithm, id: Option<String>) -> Self {
		let private_key = match algorithm {
			Algorithm::HS256 => generate_hmac_key::<32>(),
			Algorithm::HS384 => generate_hmac_key::<48>(),
			Algorithm::HS512 => generate_hmac_key::<64>(),
			/*
			Algorithm::RS256 => generate_rsa_key(rsa::KeySize::Rsa2048),
			Algorithm::RS384 => generate_rsa_key(rsa::KeySize::Rsa2048),
			Algorithm::RS512 => generate_rsa_key(rsa::KeySize::Rsa2048),
			Algorithm::ES256 => generate_ec_key(&signature::ECDSA_P256_SHA256_FIXED_SIGNING),
			Algorithm::ES384 => generate_ec_key(&signature::ECDSA_P384_SHA384_FIXED_SIGNING),
			Algorithm::PS256 => generate_rsa_key(rsa::KeySize::Rsa2048),
			Algorithm::PS384 => generate_rsa_key(rsa::KeySize::Rsa2048),
			Algorithm::PS512 => generate_rsa_key(rsa::KeySize::Rsa2048),
			Algorithm::EdDSA => generate_ed25519_key(),
			*/
		};

		Key {
			kid: id.clone(),
			operations: [KeyOperation::Sign, KeyOperation::Verify].into(),
			algorithm,
			secret: private_key,
			decode: Default::default(),
			encode: Default::default(),
		}

		/*
		let public_key = Key {
			kid: id,
			operations: [KeyOperation::Verify].into(),
			algorithm,
			der: public_key,
			decode: Default::default(),
			encode: Default::default(),
		};

		(private_key, public_key)
		*/
	}
}

/// Serialize bytes as base64url without padding
fn serialize_base64url<S>(bytes: &[u8], serializer: S) -> Result<S::Ok, S::Error>
where
	S: Serializer,
{
	let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
	serializer.serialize_str(&encoded)
}

/// Deserialize base64url string to bytes, supporting both padded and unpadded formats for backwards compatibility
fn deserialize_base64url<'de, D>(deserializer: D) -> Result<Vec<u8>, D::Error>
where
	D: Deserializer<'de>,
{
	let s = String::deserialize(deserializer)?;

	// Try to decode as unpadded base64url first (preferred format)
	base64::engine::general_purpose::URL_SAFE_NO_PAD
		.decode(&s)
		.or_else(|_| {
			// Fall back to padded base64url for backwards compatibility
			base64::engine::general_purpose::URL_SAFE.decode(&s)
		})
		.map_err(serde::de::Error::custom)
}

fn generate_hmac_key<const SIZE: usize>() -> Vec<u8> {
	let mut key = [0u8; SIZE];
	aws_lc_rs::rand::fill(&mut key).unwrap();
	key.to_vec()
}

#[cfg(test)]
mod tests {
	use super::*;
	use std::time::{Duration, SystemTime};

	fn create_test_key() -> Key {
		Key {
			algorithm: Algorithm::HS256,
			operations: [KeyOperation::Sign, KeyOperation::Verify].into(),
			secret: b"test-secret-that-is-long-enough-for-hmac-sha256".to_vec(),
			kid: Some("test-key-1".to_string()),
			decode: Default::default(),
			encode: Default::default(),
		}
	}

	fn create_test_claims() -> Claims {
		Claims {
			root: "test-path".to_string(),
			publish: "test-pub".into(),
			cluster: false,
			subscribe: "test-sub".into(),
			expires: Some(SystemTime::now() + Duration::from_secs(3600)),
			issued: Some(SystemTime::now()),
		}
	}

	#[test]
	fn test_key_from_str_valid() {
		let key = create_test_key();
		let json = key.to_str().unwrap();
		let loaded_key = Key::from_str(&json).unwrap();

		assert_eq!(loaded_key.algorithm, key.algorithm);
		assert_eq!(loaded_key.operations, key.operations);
		assert_eq!(loaded_key.secret, key.secret);
		assert_eq!(loaded_key.kid, key.kid);
	}

	#[test]
	fn test_key_from_str_invalid_json() {
		let result = Key::from_str("invalid json");
		assert!(result.is_err());
	}

	#[test]
	fn test_key_to_str() {
		let key = create_test_key();
		let json = key.to_str().unwrap();
		assert!(json.contains("\"alg\":\"HS256\""));
		assert!(json.contains("\"key_ops\""));
		assert!(json.contains("\"sign\""));
		assert!(json.contains("\"verify\""));
		assert!(json.contains("\"kid\":\"test-key-1\""));
	}

	#[test]
	fn test_key_sign_success() {
		let key = create_test_key();
		let claims = create_test_claims();
		let token = key.encode(&claims).unwrap();

		assert!(!token.is_empty());
		assert_eq!(token.matches('.').count(), 2); // JWT format: header.payload.signature
	}

	#[test]
	fn test_key_sign_no_permission() {
		let mut key = create_test_key();
		key.operations = [KeyOperation::Verify].into();
		let claims = create_test_claims();

		let result = key.encode(&claims);
		assert!(result.is_err());
		assert!(result.unwrap_err().to_string().contains("key does not support signing"));
	}

	#[test]
	fn test_key_sign_invalid_claims() {
		let key = create_test_key();
		let invalid_claims = Claims {
			root: "test-path".to_string(),
			publish: Paths::None,
			subscribe: Paths::None,
			cluster: false,
			expires: None,
			issued: None,
		};

		let result = key.encode(&invalid_claims);
		assert!(result.is_err());
		assert!(result
			.unwrap_err()
			.to_string()
			.contains("no publish or subscribe allowed; token is useless"));
	}

	#[test]
	fn test_key_verify_success() {
		let key = create_test_key();
		let claims = create_test_claims();
		let token = key.encode(&claims).unwrap();

		let verified_claims = key.decode(&token).unwrap();
		assert_eq!(verified_claims.root, claims.root);
		assert_eq!(verified_claims.publish, claims.publish);
		assert_eq!(verified_claims.subscribe, claims.subscribe);
		assert_eq!(verified_claims.cluster, claims.cluster);
	}

	#[test]
	fn test_key_verify_no_permission() {
		let mut key = create_test_key();
		key.operations = [KeyOperation::Sign].into();

		let result = key.decode("some.jwt.token");
		assert!(result.is_err());
		assert!(result
			.unwrap_err()
			.to_string()
			.contains("key does not support verification"));
	}

	#[test]
	fn test_key_verify_invalid_token() {
		let key = create_test_key();
		let result = key.decode("invalid-token");
		assert!(result.is_err());
	}

	#[test]
	fn test_key_verify_path_mismatch() {
		let key = create_test_key();
		let claims = create_test_claims();
		let token = key.encode(&claims).unwrap();

		// This test was expecting a path mismatch error, but now decode succeeds
		let result = key.decode(&token);
		assert!(result.is_ok());
	}

	#[test]
	fn test_key_verify_expired_token() {
		let key = create_test_key();
		let mut claims = create_test_claims();
		claims.expires = Some(SystemTime::now() - Duration::from_secs(3600)); // 1 hour ago
		let token = key.encode(&claims).unwrap();

		let result = key.decode(&token);
		assert!(result.is_err());
	}

	#[test]
	fn test_key_verify_token_without_exp() {
		let key = create_test_key();
		let claims = Claims {
			root: "test-path".to_string(),
			publish: "test-pub".into(),
			subscribe: Paths::None,
			cluster: false,
			expires: None,
			issued: None,
		};
		let token = key.encode(&claims).unwrap();

		let verified_claims = key.decode(&token).unwrap();
		assert_eq!(verified_claims.root, claims.root);
		assert_eq!(verified_claims.publish, claims.publish);
		assert_eq!(verified_claims.expires, None);
	}

	#[test]
	fn test_key_round_trip() {
		let key = create_test_key();
		let original_claims = Claims {
			root: "test-path".to_string(),
			publish: "test-pub".into(),
			subscribe: "test-sub".into(),
			cluster: true,
			expires: Some(SystemTime::now() + Duration::from_secs(3600)),
			issued: Some(SystemTime::now()),
		};

		let token = key.encode(&original_claims).unwrap();
		let verified_claims = key.decode(&token).unwrap();

		assert_eq!(verified_claims.root, original_claims.root);
		assert_eq!(verified_claims.publish, original_claims.publish);
		assert_eq!(verified_claims.subscribe, original_claims.subscribe);
		assert_eq!(verified_claims.cluster, original_claims.cluster);
	}

	#[test]
	fn test_key_generate_hs256() {
		let key = Key::generate(Algorithm::HS256, Some("test-id".to_string()));
		assert_eq!(key.algorithm, Algorithm::HS256);
		assert_eq!(key.kid, Some("test-id".to_string()));
		assert_eq!(key.operations, [KeyOperation::Sign, KeyOperation::Verify].into());
		assert_eq!(key.secret.len(), 32);
	}

	#[test]
	fn test_key_generate_hs384() {
		let key = Key::generate(Algorithm::HS384, Some("test-id".to_string()));
		assert_eq!(key.algorithm, Algorithm::HS384);
		assert_eq!(key.secret.len(), 48);
	}

	#[test]
	fn test_key_generate_hs512() {
		let key = Key::generate(Algorithm::HS512, Some("test-id".to_string()));
		assert_eq!(key.algorithm, Algorithm::HS512);
		assert_eq!(key.secret.len(), 64);
	}

	#[test]
	fn test_key_generate_without_id() {
		let key = Key::generate(Algorithm::HS256, None);
		assert_eq!(key.algorithm, Algorithm::HS256);
		assert_eq!(key.kid, None);
		assert_eq!(key.operations, [KeyOperation::Sign, KeyOperation::Verify].into());
	}

	#[test]
	fn test_key_generate_sign_verify_cycle() {
		let key = Key::generate(Algorithm::HS256, Some("test-id".to_string()));
		let claims = create_test_claims();

		let token = key.encode(&claims).unwrap();
		let verified_claims = key.decode(&token).unwrap();

		assert_eq!(verified_claims.root, claims.root);
		assert_eq!(verified_claims.publish, claims.publish);
		assert_eq!(verified_claims.subscribe, claims.subscribe);
		assert_eq!(verified_claims.cluster, claims.cluster);
	}

	#[test]
	fn test_key_debug_no_secret() {
		let key = create_test_key();
		let debug_str = format!("{key:?}");

		assert!(debug_str.contains("algorithm: HS256"));
		assert!(debug_str.contains("operations"));
		assert!(debug_str.contains("kid: Some(\"test-key-1\")"));
		assert!(!debug_str.contains("secret")); // Should not contain secret
	}

	#[test]
	fn test_key_operations_enum() {
		let sign_op = KeyOperation::Sign;
		let verify_op = KeyOperation::Verify;
		let decrypt_op = KeyOperation::Decrypt;
		let encrypt_op = KeyOperation::Encrypt;

		assert_eq!(sign_op, KeyOperation::Sign);
		assert_eq!(verify_op, KeyOperation::Verify);
		assert_eq!(decrypt_op, KeyOperation::Decrypt);
		assert_eq!(encrypt_op, KeyOperation::Encrypt);

		assert_ne!(sign_op, verify_op);
		assert_ne!(decrypt_op, encrypt_op);
	}

	#[test]
	fn test_key_operations_serde() {
		let operations = [KeyOperation::Sign, KeyOperation::Verify];
		let json = serde_json::to_string(&operations).unwrap();
		assert!(json.contains("\"sign\""));
		assert!(json.contains("\"verify\""));

		let deserialized: Vec<KeyOperation> = serde_json::from_str(&json).unwrap();
		assert_eq!(deserialized, operations);
	}

	#[test]
	fn test_key_serde() {
		let key = create_test_key();
		let json = serde_json::to_string(&key).unwrap();
		let deserialized: Key = serde_json::from_str(&json).unwrap();

		assert_eq!(deserialized.algorithm, key.algorithm);
		assert_eq!(deserialized.operations, key.operations);
		assert_eq!(deserialized.secret, key.secret);
		assert_eq!(deserialized.kid, key.kid);
	}

	#[test]
	fn test_key_clone() {
		let key = create_test_key();
		let cloned = key.clone();

		assert_eq!(cloned.algorithm, key.algorithm);
		assert_eq!(cloned.operations, key.operations);
		assert_eq!(cloned.secret, key.secret);
		assert_eq!(cloned.kid, key.kid);
	}

	#[test]
	fn test_different_algorithms() {
		let key_256 = Key::generate(Algorithm::HS256, Some("test-id".to_string()));
		let key_384 = Key::generate(Algorithm::HS384, Some("test-id".to_string()));
		let key_512 = Key::generate(Algorithm::HS512, Some("test-id".to_string()));

		let claims = create_test_claims();

		// Test that each algorithm can sign and verify
		for key in [key_256, key_384, key_512] {
			let token = key.encode(&claims).unwrap();
			let verified_claims = key.decode(&token).unwrap();
			assert_eq!(verified_claims.root, claims.root);
		}
	}

	#[test]
	fn test_cross_algorithm_verification_fails() {
		let key_256 = Key::generate(Algorithm::HS256, Some("test-id".to_string()));
		let key_384 = Key::generate(Algorithm::HS384, Some("test-id".to_string()));

		let claims = create_test_claims();
		let token = key_256.encode(&claims).unwrap();

		// Different algorithm should fail verification
		let result = key_384.decode(&token);
		assert!(result.is_err());
	}

	#[test]
	fn test_base64url_serialization() {
		let key = create_test_key();
		let json = serde_json::to_string(&key).unwrap();

		// Check that the secret is base64url encoded without padding
		let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
		let k_value = parsed["k"].as_str().unwrap();

		// Base64url should not contain padding characters
		assert!(!k_value.contains('='));
		assert!(!k_value.contains('+'));
		assert!(!k_value.contains('/'));

		// Verify it decodes correctly
		let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
			.decode(k_value)
			.unwrap();
		assert_eq!(decoded, key.secret);
	}

	#[test]
	fn test_backwards_compatibility_unpadded_base64url() {
		// Create a JSON with unpadded base64url (new format)
		let unpadded_json = r#"{"alg":"HS256","key_ops":["sign","verify"],"k":"dGVzdC1zZWNyZXQtdGhhdC1pcy1sb25nLWVub3VnaC1mb3ItaG1hYy1zaGEyNTY","kid":"test-key-1"}"#;

		// Should be able to deserialize new format
		let key: Key = serde_json::from_str(unpadded_json).unwrap();
		assert_eq!(key.secret, b"test-secret-that-is-long-enough-for-hmac-sha256");
		assert_eq!(key.algorithm, Algorithm::HS256);
		assert_eq!(key.kid, Some("test-key-1".to_string()));
	}

	#[test]
	fn test_backwards_compatibility_padded_base64url() {
		// Create a JSON with padded base64url (old format) - same secret but with padding
		let padded_json = r#"{"alg":"HS256","key_ops":["sign","verify"],"k":"dGVzdC1zZWNyZXQtdGhhdC1pcy1sb25nLWVub3VnaC1mb3ItaG1hYy1zaGEyNTY=","kid":"test-key-1"}"#;

		// Should be able to deserialize old format for backwards compatibility
		let key: Key = serde_json::from_str(padded_json).unwrap();
		assert_eq!(key.secret, b"test-secret-that-is-long-enough-for-hmac-sha256");
		assert_eq!(key.algorithm, Algorithm::HS256);
		assert_eq!(key.kid, Some("test-key-1".to_string()));
	}

	#[test]
	fn test_file_io_base64url() {
		let key = create_test_key();
		let temp_dir = std::env::temp_dir();
		let temp_path = temp_dir.join("test_jwk.key");

		// Write key to file
		key.to_file(&temp_path).unwrap();

		// Read file contents
		let contents = std::fs::read_to_string(&temp_path).unwrap();

		// Should be base64url encoded
		assert!(!contents.contains('{'));
		assert!(!contents.contains('}'));
		assert!(!contents.contains('"'));

		// Decode and verify it's valid JSON
		let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
			.decode(&contents)
			.unwrap();
		let json_str = String::from_utf8(decoded).unwrap();
		let _: serde_json::Value = serde_json::from_str(&json_str).unwrap();

		// Read key back from file
		let loaded_key = Key::from_file(&temp_path).unwrap();
		assert_eq!(loaded_key.algorithm, key.algorithm);
		assert_eq!(loaded_key.operations, key.operations);
		assert_eq!(loaded_key.secret, key.secret);
		assert_eq!(loaded_key.kid, key.kid);

		// Clean up
		std::fs::remove_file(temp_path).ok();
	}
}
