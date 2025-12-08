# Infrastructure

OpenTofu/Terraform configuration for deploying clustered MoQ relays to Linode.
There's nothing special about Linode, other cloud providers will work provided they support UDP and public IPs.

However, we do use GCP for GeoDNS because most providers don't support it or too expensive (Cloudflare).

## Setup

1. Copy `terraform.tfvars.example` to `terraform.tfvars` and fill in values
2. Run `tofu init`.
3. Run `tofu apply`.
4. Create a `secrets/` directory with JWT/JWK credentials:
  - ```bash
	mkdir -p secrets

	# generate the root key private key
	cargo run --bin moq-token -- --key secrets/root.jwk generate > secrets/root.jwk

	# to allow relay servers to connect to each other
	cargo run --bin moq-token -- --key secrets/root.jwk sign --publish "" --subscribe "" --cluster > secrets/cluster.jwt

	# to allow publishing to `demo/`
    cargo run --bin moq-token -- --key secrets/root.jwk sign --root "demo" --publish "" > secrets/demo-pub.jwt
    ```

## Deploy
Use `just` to see all of the available commands.

1. `just nodes` to see the available nodes.
2. `just deploy-all` to deploy to all nodes in parallel.
3. `just ssh <node>` to SSH into a specific node.
4. `just logs <node>` to view the logs of a specific node.
5. etc

## Costs
Change the number of nodes in [input.tf](input.tf).

- ~$75/month for 3 semi-decent nodes with `g6-standard-2`.
- ~$15/month for 3 cheap nodes with `g6-nanode-1`.
