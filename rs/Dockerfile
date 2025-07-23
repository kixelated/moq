
FROM nixos/nix:latest AS builder
ENV NIX_CONFIG="experimental-features = nix-command flakes"

WORKDIR /build

RUN mkdir -p /output/store

COPY . .
RUN --mount=type=cache,target=/root/.cache --mount=type=cache,target=/nix,from=nixos/nix:latest,source=/nix \
	nix build . --out-link result && \
	cp -r $(nix-store -qR result) /output/store && \
	cp -r $(readlink -f result) /output/result

# moq-relay target
FROM builder AS moq-relay
COPY --from=builder /output/store /nix/store
COPY --from=builder /output/result/bin/moq-relay /bin/moq-relay
ENTRYPOINT ["/bin/moq-relay"]

# hang target
FROM builder AS hang
COPY --from=builder /output/store /nix/store
COPY --from=builder /output/result/bin/hang /bin/hang
ENTRYPOINT ["/bin/hang"]

# moq-token target
FROM builder AS moq-token
COPY --from=builder /output/store /nix/store
COPY --from=builder /output/result/bin/moq-token /bin/moq-token
ENTRYPOINT ["/bin/moq-token"]

# hang-bbb target (TODO remove)
FROM builder AS hang-bbb
COPY --from=builder /output/store /nix/store
COPY --from=builder /output/result/bin/hang-bbb /bin/hang-bbb
ENTRYPOINT ["/bin/hang-bbb"]

# all targets
FROM builder
COPY --from=builder /output/store /nix/store
COPY --from=builder /output/result/bin/* /bin/
