# moq-token

A simple JWT and JWK based authentication scheme for moq-relay.

## Installation

```bash
npm install moq-token
```

## Usage

```typescript
import { Key, Claims, Algorithm } from 'moq-token';

// Create a key for HMAC signing
const key = Key.generate(Algorithm.HS256, 'my-key-id');

// Create claims
const claims = new Claims({
	root: 'demo/',
	publish: 'bbb',
	subscribe: 'bbb',
	expires: new Date(Date.now() + 3600000), // 1 hour from now
	issued: new Date()
});

// Sign a token
const token = await key.encode(claims);
console.log('Token:', token);

// Verify a token
const verifiedClaims = await key.decode(token);
console.log('Verified claims:', verifiedClaims);
```

## API

### Algorithm

Supported algorithms:
- `HS256` - HMAC with SHA-256
- `HS384` - HMAC with SHA-384
- `HS512` - HMAC with SHA-512

### Claims

The JWT payload structure:

```typescript
interface Claims {
	root?: string;           // Root path for publish/subscribe (optional)
	publish?: string;        // Publish permission pattern
	subscribe?: string;      // Subscribe permission pattern
	cluster?: boolean;       // Whether this is a cluster node
	expires?: Date;          // Token expiration time
	issued?: Date;           // Token issued time
}
```

### Key

Key management and JWT operations:

```typescript
class Key {
	static generate(algorithm: Algorithm, id?: string): Key;
	encode(claims: Claims): Promise<string>;
	decode(token: string): Promise<Claims>;
}
```

## License

MIT OR Apache-2.0
