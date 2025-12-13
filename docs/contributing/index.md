---
title: Contributing
description: How to contribute to MoQ
---

# Contributing

Thank you for your interest in contributing to MoQ! This project welcomes contributions from everyone.

## Ways to Contribute

- **Report bugs** - Open issues on [GitHub](https://github.com/moq-dev/moq/issues)
- **Suggest features** - Share ideas for improvements
- **Submit pull requests** - Fix bugs or add features
- **Improve documentation** - Help make docs clearer
- **Share your experience** - Blog posts, demos, tutorials

## Getting Started

1. **Fork the repository** on [GitHub](https://github.com/moq-dev/moq)
2. **Clone your fork** locally
3. **Set up development environment** - See [Development Setup](/contributing/development)
4. **Create a branch** for your changes
5. **Make your changes** and commit them
6. **Run tests** with `just check`
7. **Push to your fork** and open a pull request

## Code of Conduct

Be respectful and inclusive. We aim to foster a welcoming community for all contributors.

## Development Workflow

### Before You Start

- Check existing issues and PRs to avoid duplication
- For large changes, open an issue first to discuss
- Follow the existing code style and conventions

### Making Changes

```bash
# Create a new branch
git checkout -b feature/my-feature

# Make your changes
# ...

# Run tests and linting
just check

# Fix linting issues automatically
just fix

# Commit your changes
git commit -m "Add my feature"

# Push to your fork
git push origin feature/my-feature
```

### Pull Request Process

1. **Update documentation** if needed
2. **Add tests** for new functionality
3. **Ensure all tests pass** (`just check`)
4. **Write clear commit messages**
5. **Open a pull request** with a description of changes
6. **Respond to review feedback**

## Project Guidelines

### Code Style

**Rust:**
- Follow standard Rust conventions
- Use `rustfmt` for formatting (run `just fix`)
- Use `clippy` for linting (run `just check`)

**TypeScript/JavaScript:**
- Use Biome for formatting and linting
- Run `just fix` to auto-format
- Follow existing patterns in the codebase

### Commit Messages

- Use clear, descriptive messages
- Start with a verb ("Add", "Fix", "Update", "Remove")
- Keep first line under 72 characters
- Add details in the body if needed

**Examples:**
```
Add support for VP9 codec in hang

- Implement VP9 encoder configuration
- Add VP9 decoder support
- Update catalog with VP9 codec info
```

### Documentation

- Update README.md when changing user-facing features
- Add inline comments for complex logic
- Update docs/ when changing architecture or APIs
- Include examples for new features

## Testing

### Running Tests

```bash
# Run all tests and linting
just check

# Run only Rust tests
cd rs && cargo test

# Run only JavaScript tests
cd js && bun test
```

### Writing Tests

- Add unit tests for new functionality
- Add integration tests for complex features
- Ensure tests are deterministic and fast

## Rust-Specific Guidelines

- Prefer simplicity over complexity
- Avoid unnecessary dependencies
- Use `Result` for error handling
- Document public APIs with doc comments
- Run `cargo doc` to check documentation

## TypeScript-Specific Guidelines

- Use TypeScript for type safety
- Prefer modern JavaScript features
- Keep bundle size small
- Test in multiple browsers when possible

## Areas Needing Help

Check the [GitHub issues](https://github.com/moq-dev/moq/issues) for:

- Issues labeled `good first issue`
- Issues labeled `help wanted`
- Feature requests
- Bug reports

## Communication

- **GitHub Issues** - For bugs, features, and discussions
- **Discord** - [Join the community](https://discord.gg/FCYF3p99mr)
- **Pull Requests** - For code reviews and discussions

## License

By contributing, you agree that your contributions will be licensed under the same license as the project (MIT or Apache-2.0).

## Next Steps

- Set up your [development environment](/contributing/development)
- Browse [open issues](https://github.com/moq-dev/moq/issues)
- Read the [architecture guide](/guide/architecture)
- Check out the [protocol specs](/guide/protocol)
