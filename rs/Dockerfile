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
RUN nix build .#moq-relay
ENTRYPOINT ["/build/result/bin/moq-relay"]

# moq-clock target
FROM builder AS moq-clock
RUN nix build .#moq-clock
ENTRYPOINT ["/build/result/bin/moq-clock"]

# hang target
FROM builder AS hang
RUN nix build .#hang
ENTRYPOINT ["/build/result/bin/hang"]

# hang-bbb media preparation layer
FROM builder AS hang-bbb

# Download BBB and fragment it
# It's kind of silly that we're putting it inside of the image, but it avoids a runtime fetch.
ENV URL="http://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"
RUN nix develop -c bash -c "\
	wget -nv \"${URL}\" -O \"tmp.mp4\" && \
	ffmpeg -y -loglevel error -i tmp.mp4 \
	-c copy \
	-f mp4 -movflags cmaf+separate_moof+delay_moov+skip_trailer+frag_every_frame \
	\"bbb.mp4\" && \
	rm tmp.mp4"

RUN nix build .#hang-bbb
ENTRYPOINT ["/build/result/bin/hang-bbb"]

# moq-token target
FROM builder AS moq-token
RUN nix build .#moq-token
ENTRYPOINT ["/build/result/bin/moq-token"]

# Performed last so it's the default entrypoint
FROM builder AS all
COPY --from=moq-relay /bin/moq-relay /bin/moq-relay
COPY --from=moq-clock /bin/moq-clock /bin/moq-clock
COPY --from=hang /bin/hang /bin/hang
COPY --from=moq-token /bin/moq-token /bin/moq-token
# no hang-bbb
