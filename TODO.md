# TODO - Security & Performance Issues

This file contains security and performance issues that need to be addressed. These are great tasks for first-time contributors to the MoQ project.

## Security Issues

### 🔒 DoS Protection & Rate Limiting

- [ ] **Enforce maximum size for paths** - Add configurable limits for path string lengths to prevent memory exhaustion attacks
- [ ] **Enforce maximum number of active announcements** - Add configurable limit per session/connection to prevent announcement flooding
- [ ] **Enforce maximum number of subscriptions** - Currently implicit via MAX_STREAMS, make it configurable and explicit
- [ ] **Enforce maximum size for each frame** - Add configurable frame size limits to prevent large frame DoS attacks
- [ ] **Enforce maximum count of frames per group** - Limit frames per group to prevent unbounded memory allocation
- [ ] **Enforce cumulative maximums per session/IP/user** - Add aggregate limits across all connections from the same source

### 🛡️ Input Validation & Bounds Checking

- [ ] **Fix AnnounceInit decode DoS vector (Rust)** - Add hard limit check before processing count in `rs/moq/src/message/announce.rs:108-113`
- [ ] **Fix missing DoS protection (TypeScript)** - Add count limits in `js/moq/src/wire/announce.ts:62-67`
- [ ] **Fix prefix suffix handling bug** - Correct logic in `js/moq/src/publisher.ts:92-94` for proper hierarchical path handling
- [ ] **Add timeout protection for session initialization** - Prevent indefinite hangs in `rs/moq/src/session/mod.rs:64-66`

### 🔍 Protocol Security

- [ ] **Validate message sequence numbers** - Ensure monotonic ordering and detect replay attacks
- [ ] **Add authentication to sensitive operations** - Require proper auth for publish/announce operations
- [ ] **Implement proper error boundaries** - Prevent cascading failures from malformed messages
- [ ] **Add message rate limiting per connection** - Prevent control message flooding

## Performance Issues

### ⚡ Memory Management

- [ ] **Implement bounded collections** - Replace unbounded Vec/Array usage with size-limited collections
- [ ] **Add memory pool for frequent allocations** - Reduce GC pressure in TypeScript and allocator pressure in Rust
- [ ] **Optimize string handling** - Use string interning for frequently used path names
- [ ] **Add configurable buffer sizes** - Make frame/group buffers configurable based on use case

### 📊 Metrics & Observability

- [ ] **Add connection health metrics** - Track bandwidth, latency, error rates per connection
- [ ] **Implement graceful degradation** - Reduce quality/features under resource pressure
- [ ] **Add resource usage monitoring** - Track memory, CPU, network usage per session
- [ ] **Log security events** - Audit log for rate limit violations, auth failures, etc.

## Implementation Guidelines

When working on these issues:

1. **Security First**: Always validate inputs and add appropriate bounds checking
2. **Configurable Limits**: Make all limits configurable via environment variables or config files
3. **Backwards Compatibility**: Ensure changes don't break existing protocol compatibility
4. **Test Coverage**: Add tests for both normal operation and edge cases/attack scenarios
5. **Documentation**: Update protocol documentation and API docs for any changes
6. **Performance Testing**: Benchmark changes to ensure they don't introduce performance regressions

## Getting Started

New contributors should:

1. Read the main [CLAUDE.md](./CLAUDE.md) for project setup and development guidelines
2. Run `just install` to install dependencies
3. Run `just check` to ensure tests pass before making changes
4. Pick a single TODO item to work on
5. Create a PR with tests and documentation for your changes

## Questions?

For questions about these issues or implementation guidance, please:
- Open a GitHub issue with the `question` label
- Reference the specific TODO item you're asking about
- Include your proposed approach for discussion
