
FROM nixos/nix:latest AS builder
ENV NIX_CONFIG="experimental-features = nix-command flakes"

WORKDIR /build

RUN mkdir -p /output/store

COPY . .

# Build only moq-relay
FROM builder AS builder-moq-relay
RUN --mount=type=cache,target=/root/.cache --mount=type=cache,target=/nix,from=nixos/nix:latest,source=/nix \
	nix build .#moq-relay --out-link result && \
	cp -r $(nix-store -qR result) /output/store && \
	cp -r $(readlink -f result) /output/result

# moq-relay target
FROM scratch AS moq-relay
COPY --from=builder-moq-relay /output/store /nix/store
COPY --from=builder-moq-relay /output/result/bin/moq-relay /bin/moq-relay
ENTRYPOINT ["/bin/moq-relay"]

# Build only hang
FROM builder AS builder-hang
RUN --mount=type=cache,target=/root/.cache --mount=type=cache,target=/nix,from=nixos/nix:latest,source=/nix \
	nix build .#hang --out-link result && \
	cp -r $(nix-store -qR result) /output/store && \
	cp -r $(readlink -f result) /output/result

# hang target
FROM scratch AS hang
COPY --from=builder-hang /output/store /nix/store
COPY --from=builder-hang /output/result/bin/hang /bin/hang
ENTRYPOINT ["/bin/hang"]

# Build only moq-token
FROM builder AS builder-moq-token
RUN --mount=type=cache,target=/root/.cache --mount=type=cache,target=/nix,from=nixos/nix:latest,source=/nix \
	nix build .#moq-token --out-link result && \
	cp -r $(nix-store -qR result) /output/store && \
	cp -r $(readlink -f result) /output/result

# moq-token target
FROM scratch AS moq-token
COPY --from=builder-moq-token /output/store /nix/store
COPY --from=builder-moq-token /output/result/bin/moq-token /bin/moq-token
ENTRYPOINT ["/bin/moq-token"]

# Build only hang-bbb
FROM builder AS builder-hang-bbb
RUN --mount=type=cache,target=/root/.cache --mount=type=cache,target=/nix,from=nixos/nix:latest,source=/nix \
	nix build .#hang-bbb --out-link result && \
	cp -r $(nix-store -qR result) /output/store && \
	cp -r $(readlink -f result) /output/result

# hang-bbb target (TODO remove)
FROM scratch AS hang-bbb
COPY --from=builder-hang-bbb /output/store /nix/store
COPY --from=builder-hang-bbb /output/result/bin/hang-bbb /bin/hang-bbb
ENTRYPOINT ["/bin/hang-bbb"]


# Build all packages by default
FROM builder AS builder-all
RUN --mount=type=cache,target=/root/.cache --mount=type=cache,target=/nix,from=nixos/nix:latest,source=/nix \
	nix build . --out-link result && \
	cp -r $(nix-store -qR result) /output/store && \
	cp -r $(readlink -f result) /output/result

# all targets
FROM scratch
COPY --from=builder-all /output/store /nix/store
COPY --from=builder-all /output/result/bin/* /bin/
