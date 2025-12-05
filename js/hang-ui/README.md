<p align="center">
	<img height="128px" src="https://github.com/kixelated/moq/blob/main/.github/logo.svg" alt="Media over QUIC">
</p>

# @kixelated/hang-ui

[![npm version](https://img.shields.io/npm/v/@kixelated/hang-ui)](https://www.npmjs.com/package/@kixelated/hang-ui)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-blue.svg)](https://www.typescriptlang.org/)

A TypeScript library for interacting with @kixelated/hang Web Components. Provides methods to control playback and publish sources, as well as status of the connection.

## Installation

```bash
npm add @kixelated/hang-ui
# or
pnpm add @kixelated/hang-ui
yarn add @kixelated/hang-ui
bun add @kixelated/hang-ui
```

## Web Components

Currently, there are two Web Components provided by @kixelated/hang-ui:

- `<hang-watch-ui>`
- `<hang-publish-ui>`

Here's how you can use them (see also @kixelated/hang-demo for a complete example):

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
