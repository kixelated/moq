# This dockerfile is super slow because nothing is cached.
# We only use it for releases, so it's not a big deal.

FROM nixos/nix:latest AS builder
ENV NIX_CONFIG="experimental-features = nix-command flakes"

WORKDIR /build

# moq-relay target
FROM builder AS moq-relay
COPY . .
RUN --mount=type=cache,target=/root/.cache nix build .#moq-relay
ENTRYPOINT ["/build/result/bin/moq-relay"]

# moq-clock target
FROM builder AS moq-clock
COPY . .
RUN --mount=type=cache,target=/root/.cache nix build .#moq-clock
ENTRYPOINT ["/build/result/bin/moq-clock"]

# hang target
FROM builder AS hang
COPY . .
RUN --mount=type=cache,target=/root/.cache nix build .#hang
ENTRYPOINT ["/build/result/bin/hang"]

# hang-bbb target (TODO remove)
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

COPY . .
RUN --mount=type=cache,target=/root/.cache nix build .#hang-bbb
ENTRYPOINT ["/build/result/bin/hang-bbb"]

# moq-token target
FROM builder AS moq-token
COPY . .
RUN --mount=type=cache,target=/root/.cache nix build .#moq-token
ENTRYPOINT ["/build/result/bin/moq-token"]

# Performed last so it's the default entrypoint
FROM builder AS all
COPY . .
RUN --mount=type=cache,target=/root/.cache nix build .
