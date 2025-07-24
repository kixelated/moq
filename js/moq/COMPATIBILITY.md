# MoQ Transport Compatibility Layer

This document outlines the plan for implementing a compatibility layer between `moq-lite` and `moq-transport-07` protocols.

## Overview

The compatibility layer allows the same client API to work with both moq-lite and moq-transport servers. The protocol detection happens during the initial handshake, and the underlying implementation switches between the two protocols while maintaining API compatibility.

## Architecture Changes Made

### Directory Structure
- **src/lite/**: Contains moq-lite protocol implementation (renamed from src/wire/)
- **src/transport/**: Contains moq-transport-07 protocol implementation
- **src/stream.ts**: Generic stream handling utilities (moved from src/wire/stream.ts)

### Generic Stream Layer
The stream.ts file has been made protocol-agnostic:
- Removed hardcoded message type handling
- Added generic interfaces `StreamMessage` and `StreamMessageDecoder<T>`
- Made `Stream.accept()`, `Stream.open()`, and `Writer.open()` methods generic
- Updated `Readers<T>` class to accept decoder maps

## Compatibility Layer Design

### 1. Protocol Detection
Since moq-lite and moq-transport use different handshake messages, **users must explicitly specify the protocol version during connection setup**:

```typescript
// For moq-lite
const client = new MoQClient({ protocol: 'lite' });

// For moq-transport  
const client = new MoQClient({ protocol: 'transport' });
```

**Rationale**: The handshake messages are fundamentally different:
- moq-lite: `SESSION_CLIENT`/`SESSION_SERVER` with version format `0xff0dad00 + draft`
- moq-transport: `CLIENT_SETUP`/`SERVER_SETUP` with version `0x00000001` and parameters

### 2. Supported Features

The compatibility layer will **ONLY** support features equivalent to moq-lite capabilities:

#### ✅ Supported (moq-lite equivalent)
- **Stream-per-group delivery**: moq-transport's "Subgroup" delivery mode
- **Basic subscription**: Track-level subscriptions without complex filters
- **Priority handling**: Basic priority support
- **Session management**: Connection setup and teardown

#### ❌ Unsupported (moq-transport extensions)
- **Track delivery mode**: Objects delivered per track stream
- **Datagram delivery mode**: Objects delivered via datagrams  
- **Complex subscription filters**: Latest Group/Object, Absolute Start/Range
- **Relay features**: Namespace routing, caching hints
- **Partial object retrieval**: Object range requests

### 3. Error Handling

When connected to a moq-transport server that attempts to use unsupported features:

```typescript
// If server sends Track or Datagram delivery mode
throw new MoQError("UNSUPPORTED_DELIVERY_MODE", 
  "Server attempted to use delivery mode not supported by moq-lite compatibility");

// If server uses complex subscription filters  
throw new MoQError("UNSUPPORTED_FILTER", 
  "Server attempted to use subscription filter not supported by moq-lite compatibility");
```

**Connection Behavior**: These errors will close the connection immediately since they indicate fundamental protocol mismatches.

### 4. API Design

The client API remains identical regardless of underlying protocol:

```typescript
interface MoQClient {
  // Same API for both protocols
  subscribe(track: string, priority?: number): Promise<Subscription>;
  publish(track: string): Promise<Publisher>; 
  close(): Promise<void>;
}
```

**Internal Translation**:
- moq-lite: Direct message mapping
- moq-transport: 
  - `Subscribe` messages use only basic track-level subscriptions
  - Force `DeliveryMode.Subgroup` for all subscriptions
  - Ignore advanced parameters/filters

### 5. Implementation Strategy

```typescript
// Protocol factory pattern
class MoQClientFactory {
  static create(options: { protocol: 'lite' | 'transport' }): MoQClient {
    switch (options.protocol) {
      case 'lite':
        return new MoQLiteClient();
      case 'transport': 
        return new MoQTransportClient(); // Limited to lite-equivalent features
    }
  }
}
```

### 6. Message Mapping

| moq-lite | moq-transport | Notes |
|----------|---------------|--------|
| `SESSION_CLIENT` | `CLIENT_SETUP` | Different handshake entirely |
| `SESSION_SERVER` | `SERVER_SETUP` | Different handshake entirely |
| `Subscribe` | `Subscribe` | Restrict to basic filters only |
| `Group` stream | `ObjectStream` (Subgroup mode) | Force subgroup delivery |
| N/A | `ObjectDatagram` | **Not supported** - throw error |
| N/A | Track delivery | **Not supported** - throw error |

### 7. Version Negotiation

```typescript
// moq-lite versions
const LITE_VERSIONS = [0xff0dad04, 0xff0dad03, 0xff0dad02];

// moq-transport versions  
const TRANSPORT_VERSIONS = [0x00000001];
```

Since handshakes are different, no automatic version negotiation is possible. Users must know their server's protocol type.

### 8. Future Considerations

- **Automatic Detection**: Could potentially be added by attempting both handshake types, but adds complexity
- **Feature Flags**: Could expose optional moq-transport features behind explicit opt-in flags
- **Graceful Degradation**: Could negotiate down to lite-compatible features during handshake

## Implementation Status

- [x] Refactor stream.ts to be protocol-agnostic
- [x] Create src/lite/ directory with moq-lite implementation  
- [x] Create src/transport/ directory with basic moq-transport messages
- [ ] Implement MoQClient factory and protocol switching
- [ ] Add comprehensive error handling for unsupported features
- [ ] Add integration tests for both protocol modes
- [ ] Update documentation and examples

## Questions for Discussion

1. **Auto-detection**: Should we attempt to add automatic protocol detection by trying both handshakes?
2. **Error handling**: Should unsupported features close the connection or just log warnings?
3. **Optional features**: Should advanced moq-transport features be available behind feature flags?
4. **Compatibility scope**: Are there any other moq-lite features missing from this analysis?

## Testing Strategy

The compatibility layer should be tested with:
- moq-lite servers using all supported message types
- moq-transport servers configured to use only lite-equivalent features  
- moq-transport servers that attempt to use unsupported features (error cases)
- Integration tests ensuring API compatibility across both protocols
