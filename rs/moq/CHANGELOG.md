# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.0](https://github.com/kixelated/moq/compare/moq-lite-v0.6.3...moq-lite-v0.7.0) - 2025-09-04

### Other

- Add WebSocket fallback support ([#570](https://github.com/kixelated/moq/pull/570))

## [0.6.3](https://github.com/kixelated/moq/compare/moq-lite-v0.6.2...moq-lite-v0.6.3) - 2025-08-21

### Other

- moq.dev ([#538](https://github.com/kixelated/moq/pull/538))

## [0.6.2](https://github.com/kixelated/moq/compare/moq-lite-v0.6.1...moq-lite-v0.6.2) - 2025-08-12

### Other

- Support an array of authorized paths ([#536](https://github.com/kixelated/moq/pull/536))
- Revamp the Producer/Consumer API for moq_lite ([#516](https://github.com/kixelated/moq/pull/516))
- Add support for connecting to either moq-lite or moq-transport-07. ([#532](https://github.com/kixelated/moq/pull/532))
- Another simpler fix for now-or-never ([#526](https://github.com/kixelated/moq/pull/526))
- Less verbose errors, using % instead of ? ([#521](https://github.com/kixelated/moq/pull/521))

## [0.6.1](https://github.com/kixelated/moq/compare/moq-lite-v0.6.0...moq-lite-v0.6.1) - 2025-07-31

### Other

- Fix subscription termination bug ([#510](https://github.com/kixelated/moq/pull/510))

## [0.6.0](https://github.com/kixelated/moq/compare/moq-lite-v0.5.0...moq-lite-v0.6.0) - 2025-07-31

### Other

- Fix paths so they're relative to the root, not root + role. ([#508](https://github.com/kixelated/moq/pull/508))
- Fix some JS race conditions and bugs. ([#504](https://github.com/kixelated/moq/pull/504))
- Fix duplicate JS announcements. ([#503](https://github.com/kixelated/moq/pull/503))
- Add a compatibility layer for moq-transport-07 ([#500](https://github.com/kixelated/moq/pull/500))
- Try to fix docker again. ([#492](https://github.com/kixelated/moq/pull/492))

## [0.5.0](https://github.com/kixelated/moq/compare/moq-lite-v0.4.0...moq-lite-v0.5.0) - 2025-07-22

### Other

- Use a size prefix for messages. ([#489](https://github.com/kixelated/moq/pull/489))
- Create a type-safe Path wrapper for Javascript ([#487](https://github.com/kixelated/moq/pull/487))
- Add an ANNOUNCE_INIT message. ([#483](https://github.com/kixelated/moq/pull/483))
- Use JWT tokens for local development. ([#477](https://github.com/kixelated/moq/pull/477))

## [0.4.0](https://github.com/kixelated/moq/compare/moq-lite-v0.3.5...moq-lite-v0.4.0) - 2025-07-19

### Other

- Revamp connection URLs, broadcast paths, and origins ([#472](https://github.com/kixelated/moq/pull/472))

## [0.3.5](https://github.com/kixelated/moq/compare/moq-lite-v0.3.4...moq-lite-v0.3.5) - 2025-07-16

### Other

- Remove hang-wasm and fix some minor things. ([#465](https://github.com/kixelated/moq/pull/465))
- Readme tweaks. ([#460](https://github.com/kixelated/moq/pull/460))
- Some initally AI generated documentation. ([#457](https://github.com/kixelated/moq/pull/457))

## [0.3.4](https://github.com/kixelated/moq/compare/moq-lite-v0.3.3...moq-lite-v0.3.4) - 2025-06-29

### Other

- Revampt some JWT stuff. ([#451](https://github.com/kixelated/moq/pull/451))

## [0.3.3](https://github.com/kixelated/moq/compare/moq-lite-v0.3.2...moq-lite-v0.3.3) - 2025-06-25

### Other

- Fix a panic caused if the same broadcast is somehow announced twice. ([#439](https://github.com/kixelated/moq/pull/439))
- Improve how groups are served in Rust. ([#435](https://github.com/kixelated/moq/pull/435))

## [0.3.2](https://github.com/kixelated/moq/compare/moq-lite-v0.3.1...moq-lite-v0.3.2) - 2025-06-20

### Other

- Fix misc bugs ([#430](https://github.com/kixelated/moq/pull/430))

## [0.3.1](https://github.com/kixelated/moq/compare/moq-lite-v0.3.0...moq-lite-v0.3.1) - 2025-06-16

### Other

- Add a simple chat protocol and user details ([#416](https://github.com/kixelated/moq/pull/416))
- Minor changes. ([#409](https://github.com/kixelated/moq/pull/409))

## [0.3.0](https://github.com/kixelated/moq/compare/moq-lite-v0.2.0...moq-lite-v0.3.0) - 2025-06-03

### Other

- Add location tracks, fix some bugs, switch to nix ([#401](https://github.com/kixelated/moq/pull/401))
- Revamp origin/announced ([#390](https://github.com/kixelated/moq/pull/390))

## [0.2.0](https://github.com/kixelated/moq/compare/moq-lite-v0.1.0...moq-lite-v0.2.0) - 2025-05-21

### Other

- Split into Rust/Javascript halves and rebrand as moq-lite/hang ([#376](https://github.com/kixelated/moq/pull/376))
