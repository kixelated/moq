# moq-token

A simple JWT and JWK based authentication scheme for moq-relay.

For comprehensive documentation including token structure, authorization rules, and examples, see:
**[Authentication Documentation](../../docs/auth.md)**

## Quick Usage
```bash
moq-token --key key.jwk generate
moq-token --key key.jwk sign --root demo --publish bbb > token.jwt
moq-token --key key.jwk verify < token.jwt
```

## Public Keys
We currently don't support public key cryptography, but we should in the future.
Patches welcome!
