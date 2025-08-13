<p align="center">
	<img height="128px" src="https://github.com/kixelated/moq/blob/main/.github/logo.svg" alt="Media over QUIC">
</p>

# @kixelated/hang

[![npm version](https://img.shields.io/npm/v/@kixelated/hang)](https://www.npmjs.com/package/@kixelated/hang)
[![TypeScript](https://img.shields.io/badge/TypeScript-ready-blue.svg)](https://www.typescriptlang.org/)

A TypeScript library for real-time media streaming using [Media over QUIC](https://moq.dev/) (MoQ), supported by modern web browsers.

**`@kixelated/hang`** provides high-level media components for live audio and video streaming, built on top of [`@kixelated/moq`](../moq).
It uses new web APIs like WebCodecs, WebTransport, and Web Components.

> **Note:** This project is a [fork](https://moq.dev/blog/transfork) of the [IETF MoQ specification](https://datatracker.ietf.org/group/moq/documents/), optimized for practical deployment with a narrower focus and exponentially simpler implementation.

## Features

- 🎥 **Real-time latency** via WebTransport and WebCodecs.
- 🎵 **Low-level API** for advanced use cases, such as processing individual frames.
- 🧩 **Web Components** for easy integration.
- 🔄 **Reactive** Easy to use with React and SolidJS adapters.

## Installation

```bash
npm install @kixelated/hang
# or
pnpm add @kixelated/hang
# or
yarn add @kixelated/hang
```

## Web Components (Easiest)

The fastest way to add MoQ to your web page.
Check out the [hang-demo](../hang-demo) folder for working examples.

There's also a Javascript API for more advanced use cases; see below.

```html
<!DOCTYPE html>
<html>
<head>
    <script type="module">
        // Import the web components
        import "@kixelated/hang/publish/element";
        import "@kixelated/hang/watch/element";
    </script>
</head>
<body>
    <!-- Publish camera/microphone -->
    <hang-publish
        url="https://relay.example.com/"
		name="me"
        audio
        video
        controls>
        <!-- Optional: preview element -->
        <video muted autoplay style="width: 100%; border-radius: 8px;"></video>
    </hang-publish>

    <!-- Watch live stream the live stream we're publishing -->
    <hang-watch
        url="https://relay.example.com/"
		name="me"
        controls>
        <!-- Optional: canvas for rendering video, otherwise only audio will play -->
        <canvas style="width: 100%; border-radius: 8px;"></canvas>
    </hang-watch>
</body>
</html>
```

### Tree-Shaking
Javascript bundlers often perform dead code elimination.
This can have unfortunate side effects, as it can remove the code that registers these components.

To attempt to mitigate this, you have to explicitly import components with the `/element` suffix.
Your bundler *should* be smart enough to avoid tree-shaking but you may need to `export` any types just to ensure they are not removed.

### Attributes
All of the web components support setting HTTML attributes and Javascript properties.
...what's the difference?

HTML Attributes are strings.
Javacript properties are typed and reactive.

`<hang-watch volume="0.8" />` will work, but it's not type-safe.
You can use DOM callbacks to detect when the attribute changes but it's not as convenient.

Alternatively, you could perform the same thing with Javascript properties:
```tsx
const watch = document.querySelector("hang-watch") as HangWatch;
watch.volume.set(0.8);
```

This will actually set the `volume="0.8"` attribute on the element mostly because it's cool and useful when debugging.
But it's also useful because you can use the `.subscribe` method to receive an event on change.


### `<hang-watch>`

Subscribes to a hang broadcast and renders it.

**Attributes:**
- `url` (required): The URL of the server, potentially authenticated via a `?jwt` token.
- `name` (required): The name of the broadcast.
- `controls`: Show simple playback controls.
- `paused`: Pause playback.
- `muted`: Mute audio playback.
- `volume`: Set the audio volume, only when `!muted`.


```html
<script type="module">
    import "@kixelated/hang/watch/element";
</script>

<!-- NOTE: You'll also need to publish a broadcast with the same name. See below. -->
<hang-watch
    url="https://relay.moq.dev/anon"
	name="room123/me"
    controls>
	<!-- canvas for rendering, otherwise video element will be disabled -->
    <canvas></canvas>
</hang-watch>
```


### `<hang-publish>`

Publishes a microphone/camera or screen as a hang broadcast.

**Attributes:**
- `url` (required): The URL of the server, potentially authenticated via a `?jwt` token.
- `name` (required): The name of the broadcast.
- `device`: "camera" or "screen".
- `audio`: Enable audio capture.
- `video`: Enable video capture
- `controls`: Show simple publishing controls

```html
<script type="module">
    import "@kixelated/hang/publish/element";
</script>

<hang-publish
    url="https://relay.moq.dev/anon" name="room123/me" audio video controls>
    <!-- Optional: video element for preview -->
    <video autoplay muted></video>
</hang-publish>
```

### `<hang-meet>`

Downloads multiple hang broadcasts and renders them in a grid.
Very crude and best as an example; use the JS API instead.

```html
<script type="module">
    import "@kixelated/hang/meet/element";
</script>

<hang-meet
    url="https://relay.moq.dev/anon"
	name="room123"
    audio video
    controls>
</hang-meet>
```

This will discover any broadcasts that start with `room123/` and render them.
You can also specify a `<hang-publish>` child element to publish your own broadcast, using a local preview instead of downloading it.

### `<hang-support>`

A simple element that displays browser support.

```html
<script type="module">
    import "@kixelated/hang/support/element";
</script>

<!-- Show only when a publishing feature is not supported -->
<hang-support mode="publish" show="partial" />
```


## Javascript API

**NOTE** This API is still evolving and may change in the future.
You're on your own when it comes to documentation... for now.

```typescript
import * as Hang from "@kixelated/hang";

// Create a new connection, available via `.established`
const connection = new Hang.Connection("https://relay.moq.dev/anon");

// Publishing media, with (optional) initial settings
const publish = new Hang.Publish.Broadcast(connection, {
	enabled: true,
	name: "bob",
    video: { enabled: true, device: "camera" },
});

// Subscribing to media, with (optional) initial settings
const watch = new Hang.Watch.Broadcast(connection, {
	enabled: true,
	name: "bob",
	video: { enabled: true },
});

// Note that virtually everything is reactive, so you can change settings at any time.
publish.name.set("alice");
watch.audio.enabled.set(true);
```

## Browser Compatibility

This library requires modern browser features.
We're currently only testing the most recent versions of Chrome and sometimes Firefox.

## Framework Integration

The Reactive API contains helpers to convert into React and SolidJS signals:

```ts
import react from "@kixelated/signals/react";
// same for solid

const publish = document.querySelector("hang-publish") as HangPublish;
const media = react(publish.video.media);

/// Now you have a `react` signal that changes when the video source changes.
useEffect(() => {
	video.srcObject = media();
}, [media]);
```

## License

Licensed under either:

-   Apache License, Version 2.0 ([LICENSE-APACHE](LICENSE-APACHE) or http://www.apache.org/licenses/LICENSE-2.0)
-   MIT license ([LICENSE-MIT](LICENSE-MIT) or http://opensource.org/licenses/MIT)
