# Infrastructure

OpenTofu/Terraform configuration for deploying clustered MoQ relays to Linode.
There's nothing special about Linode, other cloud providers will work provided they support UDP and public IPs.

However, we do use GCP for GeoDNS because most providers don't support it or too expensive (Cloudflare).

## Setup

1. Copy `terraform.tfvars.example` to `terraform.tfvars` and fill in values
2. Run `tofu init` to initialize
3. Create a `secrets/` directory with JWT/JWK credentials:
  - ```bash
	mkdir -p secrets

	# generate the root key private key
	cargo run --bin moq-token -- --key secrets/root.jwk generate > secrets/root.jwk

	# to allow relay servers to connect to each other
	cargo run --bin moq-token -- --key secrets/root.jwk sign --publish "" --subscribe "" --cluster > secrets/cluster.jwt

	# to allow publishing to `demo/`
    cargo run --bin moq-token -- --key secrets/root.jwk sign --root "demo" --publish "" > secrets/demo-pub.jwt
    ```
4. `just deploy-all` to deploy to all nodes

## Usage
See the [justfile](justfile) for all available commands.

```bash
# show all commands
just
```

