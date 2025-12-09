<p align="center">
	<img height="128px" src="https://github.com/moq-dev/moq/blob/main/.github/logo.svg" alt="Media over QUIC">
</p>

# @moq/hang-ui

[![npm version](https://img.shields.io/npm/v/@moq/hang-ui)](https://www.npmjs.com/package/@moq/hang-ui)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-blue.svg)](https://www.typescriptlang.org/)

A TypeScript library for interacting with @moq/hang Web Components. Provides methods to control playback and publish sources, as well as status of the connection.

## Installation

```bash
npm add @moq/hang-ui
# or
pnpm add @moq/hang-ui
yarn add @moq/hang-ui
bun add @moq/hang-ui
```

## Web Components

Currently, there are two Web Components provided by @moq/hang-ui:

- `<hang-watch-ui>`
- `<hang-publish-ui>`

Here's how you can use them (see also @moq/hang-demo for a complete example):

```html
<hang-watch-ui>
    <hang-watch url="<MOQ relay URL>" path="<relay path>" muted>
        <canvas style="width: 100%; height: auto; border-radius: 4px; margin: 0 auto;"></canvas>
    </hang-watch>
</hang-watch-ui>
```

```html
	<hang-publish-ui>
		<hang-publish url="<MOQ relay URL>" path="<relay path>">
			<video
				style="width: 100%; height: auto; border-radius: 4px; margin: 0 auto;"
				muted
				autoplay
			></video>
		</hang-publish>
	</hang-publish-ui>
```
