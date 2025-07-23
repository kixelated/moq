# Multi-stage Dockerfile that builds all binaries and creates target-specific images
# Usage: docker build --build-arg TARGET=moq-relay --target moq-relay .

# Builder stage that builds all binaries
FROM nixos/nix:latest AS builder
ENV NIX_CONFIG="experimental-features = nix-command flakes"

WORKDIR /build

# Copy the source code
COPY . .

# moq-relay target
FROM builder AS moq-relay
RUN --mount=type=cache,target=/nix,from=nixos/nix:latest,source=/nix \
	--mount=type=cache,target=/root/.cache \
	nix build .#moq-relay && \
	cp -r $(readlink -f result)/bin/* /bin/
ENTRYPOINT ["/bin/moq-relay"]

# moq-clock target
FROM builder AS moq-clock
RUN --mount=type=cache,target=/nix,from=nixos/nix:latest,source=/nix \
	--mount=type=cache,target=/root/.cache \
	nix build .#moq-clock && \
	cp -r $(readlink -f result)/bin/* /bin/
ENTRYPOINT ["/bin/moq-clock"]

# hang target
FROM builder AS hang
RUN --mount=type=cache,target=/nix,from=nixos/nix:latest,source=/nix \
	--mount=type=cache,target=/root/.cache \
	nix build .#hang && \
	cp -r $(readlink -f result)/bin/* /bin/

COPY hang-bbb /bin/hang-bbb
RUN chmod +x /bin/hang-bbb

# Use nix develop so we get ffmpeg/wget/bash (not cached)
# TODO: Fix this by having quic.video make it's own image
ENTRYPOINT ["nix", "develop", "--command", "/bin/hang"]

# moq-token target
FROM builder AS moq-token
RUN --mount=type=cache,target=/nix,from=nixos/nix:latest,source=/nix \
	--mount=type=cache,target=/root/.cache \
	nix build .#moq-token && \
	cp -r $(readlink -f result)/bin/* /bin/
ENTRYPOINT ["/bin/moq-token"]

# Performed last so it's the default entrypoint
FROM builder AS all
COPY --from=moq-relay /bin/moq-relay /bin/moq-relay
COPY --from=moq-clock /bin/moq-clock /bin/moq-clock
COPY --from=hang /bin/hang /bin/hang
COPY --from=moq-token /bin/moq-token /bin/moq-token
