# moq-transport Examples

This directory contains examples demonstrating the moq-transport-07 implementation.

## transport.ts

Demonstrates the moq-transport protocol implementation with fixes for:
- Object payload length prefixing
- ObjectSendOrder type consistency  
- Multi-object stream parsing
- Proper error handling

### Running the Example

**Prerequisites:**
- Deno runtime installed
- Network access for WebTransport connections

**Command:**
```bash
deno run --allow-net --unstable-net examples/transport.ts
```

**Flags explanation:**
- `--allow-net`: Required for WebTransport connections
- `--unstable-net`: Required for WebTransport API access in Deno

### What the Example Shows

1. **Object Stream Format**: Demonstrates the correct wire format with length prefixes
2. **Type Consistency**: Shows proper bigint usage for ObjectSendOrder 
3. **Multi-object Parsing**: Illustrates how multiple objects are encoded/decoded
4. **Error Handling**: Shows validation and error detection
5. **Stream-per-group Delivery**: The only delivery mode supported in lite compatibility

### Key Implementation Details

The example highlights the critical fixes made to the moq-transport implementation:

- **Length Prefixing**: Objects now include `u53` length prefix before payload data
- **Type Safety**: `ObjectSendOrder` is consistently `bigint` (no more conversions)
- **Stream Parsing**: Multiple objects per stream are correctly parsed
- **Validation**: Length mismatches are detected and rejected
- **Termination**: EndOfGroup markers properly close streams

### Real Server Testing

To test with an actual moq-transport-07 server like `relay.cloudflare.mediaoverquic.com`, uncomment the connection test section in the example.

Note: The server may disconnect if the CLIENT_SETUP message format doesn't exactly match the expected moq-transport-07 specification.