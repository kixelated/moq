# Authentication

MoQ uses JWT tokens for authentication and authorization, providing path-based access control for publishing and subscribing to broadcasts.

## Overview

The authentication system supports:
- **JWT-based authentication** with query parameter tokens
- **Path-based authorization** with hierarchical permissions
- **Symmetric key cryptography** (HMAC-SHA256/384/512)
- **Anonymous access** for public content
- **Cluster authentication** for relay-to-relay communication

## URL and Token Scheme

### Authentication URLs

Tokens are passed as query parameters in the connection URL:

```
https://relay.example.com/path/to/broadcast?jwt=<base64-jwt-token>
```

### Anonymous Access

For development or public content, anonymous access is supported:

```
https://relay.example.com/anon/public-broadcast
```

*Note: Anonymous access must be configured in the relay configuration (see [Configuration](#configuration) section).*

## JWT Token Structure

### Claims Format

Tokens use the following custom claims:

```json
{
  "root": "hang/meeting-123",    // Root path for all operations
  "pub": "alice",               // Publishing permissions (optional)
  "sub": "",                    // Subscription permissions (optional) 
  "cluster": false,             // Cluster node flag
  "exp": 1703980800,           // Expiration (unix timestamp)
  "iat": 1703977200            // Issued at (unix timestamp)
}
```

**Field Descriptions:**
- `root`: Base path that all operations are relative to
- `pub`: Path prefix for publishing permissions (empty = no publishing)
- `sub`: Path prefix for subscription permissions (empty = full access)
- `cluster`: If true, marks this as a cluster node (affects announcement behavior)
- `exp`: Token expiration time (unix timestamp)
- `iat`: Token issued time (unix timestamp)

### Supported Algorithms

Currently supported symmetric algorithms:
- **HS256** (HMAC with SHA-256) - recommended
- **HS384** (HMAC with SHA-384)
- **HS512** (HMAC with SHA-512)

*Note: Public key algorithms (RS256, ES256) are planned but not yet implemented.*

## Authorization Rules

### Path-Based Permissions

The system uses hierarchical path-based authorization:

1. **Connection Path**: Must match or be under the token's `root` path
2. **Publishing**: Can publish to broadcasts matching the `pub` prefix
3. **Subscribing**: Can subscribe to broadcasts matching the `sub` prefix

### Permission Examples

**Token with restricted permissions:**
```json
{
  "root": "conference/room-1",
  "pub": "alice",
  "sub": "alice,bob",
  "exp": 1703980800
}
```

This allows:
- ✅ Connect to: `https://relay.com/conference/room-1?jwt=...`
- ✅ Publish to: `alice/camera`, `alice/audio`
- ✅ Subscribe to: `alice/camera`, `bob/screen-share`
- ❌ Publish to: `bob/camera` (not allowed)
- ❌ Connect to: `https://relay.com/other-room?jwt=...` (wrong root)

**Token with full access:**
```json
{
  "root": "conference/room-1",
  "pub": "",
  "sub": "",
  "exp": 1703980800
}
```

Empty string (`""`) grants full permissions within the root path.

*Note: Omitting a field entirely (undefined) denies that permission. For example, if the `pub` field is not included in the token, you cannot publish.*

## Key Management

### Key Format

Keys use a simplified JSON Web Key format:

```json
{
  "alg": "HS256",
  "key_ops": ["sign", "verify"],
  "k": "base64url-encoded-secret",
  "kid": "optional-key-id"
}
```

### Key Generation

Using the CLI tool:

```bash
# Generate a new HMAC-SHA256 key
cargo run --bin moq-token -- --key "dev/root.jwk" generate --algorithm HS256

# Generate with key ID
cargo run --bin moq-token -- --key "dev/root.jwk" generate --algorithm HS256 --id "primary"
```

### Key Storage

- Keys are stored as base64url-encoded JSON files
- Minimum 32 bytes for HMAC operations
- Support for both new and legacy key formats

## Token Generation

### CLI Examples

**User Token:**
```bash
# Create a user token for a specific meeting
cargo run --bin moq-token -- --key "dev/root.jwk" sign \
  --root "hang/meeting-123" \
  --subscribe "" \
  --publish "alice" \
  --expires 1703980800 > user-token.jwt
```

**Cluster Token:**
```bash
# Create a cluster token (for relay-to-relay communication)
cargo run --bin moq-token -- --key "dev/root.jwk" sign \
  --root "" \
  --subscribe "" \
  --publish "" \
  --cluster > cluster-token.jwt
```

### TypeScript/JavaScript

```typescript
import { sign, load } from "@kixelated/moq-token";

// Load signing key
const key = load(base64urlEncodedKey);

// Create user token
const claims = {
  path: "hang/meeting-123",      // Note: called "path" in JS, "root" in Rust
  pub: "alice", 
  sub: "",
  exp: Math.floor(Date.now() / 1000) + 3600  // 1 hour from now
};

const token = await sign(key, claims);

// Use in connection URL
const url = `https://relay.example.com/hang/meeting-123?jwt=${token}`;
```

### Web Component Example

```html
<hang-meet url="https://localhost:4443/hang/demo?jwt=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...">
</hang-meet>
```

## Configuration

### Relay Configuration

Configure authentication in the relay server:

```toml
# dev.toml
[auth]
key = "dev/root.jwk"    # Path to JWT signing key
public = "anon"         # Allow anonymous access to /anon prefix
```

### Cluster Authentication

For multi-relay deployments:

```toml
# leaf.toml  
[cluster]
connect = "root-relay:4443"
token = "dev/cluster.jwt"    # Pre-generated cluster token
```

## Security Considerations

### Best Practices

1. **Key Security**: Store signing keys securely, use environment variables in production
2. **Token Expiration**: Always set reasonable expiration times
3. **Path Isolation**: Use specific root paths to isolate different applications/meetings
4. **HTTPS Only**: Always use TLS/HTTPS in production
5. **Key Rotation**: Plan for periodic key rotation (TODO: document rotation process)

### Current Limitations

- Only symmetric keys (HMAC) are supported
- Same key signs and verifies tokens
- No built-in key rotation mechanism
- No support for token revocation

### TODO: Future Enhancements

- [ ] Public key cryptography support (RS256, ES256)
- [ ] Token refresh mechanisms
- [ ] Key rotation procedures  
- [ ] Integration with external identity providers
- [ ] Token revocation/blacklisting

## Common Issues

### Token Validation Errors

**Invalid signature**: Check that the same key is used for signing and verification.

**Path mismatch**: Ensure the connection URL path matches the token's `root` claim.

**Expired token**: Check the `exp` claim and generate a new token if expired.

**Permission denied**: Verify the `pub`/`sub` permissions match the attempted operation.

### Development Tips

1. Use the `anon` public path for testing without authentication
2. Set long expiration times for development tokens
3. Use empty `pub`/`sub` claims for full permissions during development
4. Check relay logs for detailed authentication error messages

## Examples Repository

See the `dev/` directory for complete examples:
- `dev/root.jwk` - Development signing key
- `dev/cluster.jwt` - Cluster authentication token
- `rs/moq-relay/dev.toml` - Relay configuration with authentication

For more examples, see the `justfile` commands:
- `just token` - Generate development tokens
- `just relay` - Start relay with authentication enabled