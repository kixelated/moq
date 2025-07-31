# MoQ Rust Examples

These examples demonstrate how to use the MoQ protocol for publishing and subscribing to broadcasts using the `moq-lite` crate with `moq-native` for simplified QUIC connection setup.

## Prerequisites

Make sure you have a MoQ relay running. You can start one using:

```bash
just relay
```

## Running the Examples

### Publisher

The publisher example creates a broadcast and publishes a "clock" track that sends the current timestamp every second.

```bash
# Using command line arguments
cargo run --example publish -- https://localhost:4443 test-broadcast

# Using environment variables
MOQ_URL=https://localhost:4443 MOQ_NAME=test-broadcast cargo run --example publish

# View help
cargo run --example publish -- --help
```

### Subscriber

The subscriber example connects to a relay and subscribes to a broadcast's "clock" track, displaying the received messages.

```bash
# Using command line arguments
cargo run --example subscribe -- https://localhost:4443 test-broadcast

# Using environment variables
MOQ_URL=https://localhost:4443 MOQ_NAME=test-broadcast cargo run --example subscribe

# View help
cargo run --example subscribe -- --help
```

## How It Works

1. **Publisher**:
   - Connects to the relay using `moq-native` client
   - Creates a `BroadcastProducer` and publishes it with an `OriginProducer`
   - Creates a "clock" track within the broadcast
   - Sends JSON messages with timestamps every second

2. **Subscriber**:
   - Connects to the relay using `moq-native` client
   - Waits for the broadcast to be announced (with 1-second timeout)
   - Subscribes to the "clock" track
   - Receives and displays the messages

## TLS Configuration

For local development with self-signed certificates, you can disable TLS verification:

```bash
MOQ_CLIENT_TLS_DISABLE_VERIFY=true cargo run --example publish -- https://localhost:4443 test-broadcast
```

**Warning**: Only use this option for development. Never disable TLS verification in production!