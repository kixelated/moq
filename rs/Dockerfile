# We're using a Dockerfile despite the fact that Nix can create Docker images directly.
#
# 1. It's difficult to cross compile Docker images with Nix.
#   - I tried, but OSX makes it even more difficult.
# 2. Nix is not required for developers; `docker build .` will work.
#
# Unfortunately, it means that caching is more difficult.
# Nix uses /nix/store for both caching AND the final output (lots of symlinks).
FROM nixos/nix:latest AS builder
ENV NIX_CONFIG="experimental-features = nix-command flakes"

WORKDIR /build

RUN mkdir -p /output/store

COPY . .

# Build only moq-relay
FROM builder AS builder-moq-relay

# Okay so we cache /nix/store so we don't have to rebuild everything every time.
# Docker caches are ephemeral, and unfortunately nix creates a shitload of symlinks to /nix/store.
# So we use the nix-store command to query the dependencies of the result and copy them to /output/store.
# We also have to copy the resulting binary; it's already in the /output/store but we don't know the name.
# There's probably a better way to do this, but I just delete the duplicate to save another ~15MB.
RUN --mount=type=cache,target=/root/.cache --mount=type=cache,target=/nix,from=nixos/nix:latest,source=/nix \
	nix build .#moq-relay --out-link result && \
	cp -r $(nix-store -qR result) /output/store && \
	cp -r $(readlink -f result) /output/result && \
	rm -rf /output/store/$(basename $(readlink -f result))

# moq-relay target
FROM scratch AS moq-relay
COPY --from=builder-moq-relay /output/store /nix/store
COPY --from=builder-moq-relay /output/result/bin/* /bin/
ENTRYPOINT ["/bin/moq-relay"]

# Build only hang
FROM builder AS builder-hang
RUN --mount=type=cache,target=/root/.cache --mount=type=cache,target=/nix,from=nixos/nix:latest,source=/nix \
	nix build .#hang --out-link result && \
	cp -r $(nix-store -qR result) /output/store && \
	cp -r $(readlink -f result) /output/result && \
	rm -rf /output/store/$(basename $(readlink -f result))

# hang target
FROM scratch AS hang
COPY --from=builder-hang /output/store /nix/store
COPY --from=builder-hang /output/result/bin/* /bin/
ENTRYPOINT ["/bin/hang"]

# Build only moq-token
FROM builder AS builder-moq-token
RUN --mount=type=cache,target=/root/.cache --mount=type=cache,target=/nix,from=nixos/nix:latest,source=/nix \
	nix build .#moq-token --out-link result && \
	cp -r $(nix-store -qR result) /output/store && \
	cp -r $(readlink -f result) /output/result && \
	rm -rf /output/store/$(basename $(readlink -f result))

# moq-token target
FROM scratch AS moq-token
COPY --from=builder-moq-token /output/store /nix/store
COPY --from=builder-moq-token /output/result/bin/* /bin/
ENTRYPOINT ["/bin/moq-token"]

# Build all packages by default
FROM builder AS builder-all
RUN --mount=type=cache,target=/root/.cache --mount=type=cache,target=/nix,from=nixos/nix:latest,source=/nix \
	nix build . --out-link result && \
	cp -r $(nix-store -qR result) /output/store && \
	cp -r $(readlink -f result) /output/result && \
	rm -rf /output/store/$(basename $(readlink -f result))

# all targets
FROM scratch
COPY --from=builder-all /output/store /nix/store
COPY --from=builder-all /output/result/bin/* /bin/
