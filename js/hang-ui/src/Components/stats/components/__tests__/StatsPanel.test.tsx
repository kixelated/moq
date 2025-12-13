import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HandlerProps } from "../../types";
import { StatsPanel } from "../StatsPanel";

const mockAudioVideo: HandlerProps = {
	audio: {
		source: {
			active: {
				peek: () => "audio-data",
				changed: () => () => {},
				subscribe: () => () => {},
			},
			config: {
				peek: () => ({ sampleRate: 48000, numberOfChannels: 2, bitrate: 128000, codec: "opus" }),
				changed: () => () => {},
				subscribe: () => () => {},
			},
			stats: {
				peek: () => ({ bytesReceived: 0 }),
				changed: () => () => {},
				subscribe: () => () => {},
			},
		},
	},
	video: {
		source: {
			display: {
				peek: () => ({ width: 1920, height: 1080 }),
				changed: () => () => {},
				subscribe: () => () => {},
			},
			syncStatus: {
				peek: () => ({ state: "ready" as const }),
				changed: () => () => {},
				subscribe: () => () => {},
			},
			bufferStatus: {
				peek: () => ({ state: "filled" as const }),
				changed: () => () => {},
				subscribe: () => () => {},
			},
			latency: {
				peek: () => 100,
				changed: () => () => {},
				subscribe: () => () => {},
			},
			stats: {
				peek: () => ({ frameCount: 0, timestamp: 0, bytesReceived: 0 }),
				changed: () => () => {},
				subscribe: () => () => {},
			},
		},
	},
};

describe("StatsPanel", () => {
	let container: HTMLDivElement;
	let dispose: (() => void) | undefined;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
	});

	afterEach(() => {
		dispose?.();
		dispose = undefined;
		document.body.removeChild(container);
	});

	it("renders with correct base class", () => {
		dispose = render(() => <StatsPanel audio={mockAudioVideo.audio} video={mockAudioVideo.video} />, container);

		const panel = container.querySelector(".stats__panel");
		expect(panel).toBeTruthy();
	});

	it("renders all metric items", () => {
		dispose = render(() => <StatsPanel audio={mockAudioVideo.audio} video={mockAudioVideo.video} />, container);

		const items = container.querySelectorAll(".stats__item");
		expect(items.length).toBe(4);
	});

	it("renders items with correct icon types", () => {
		const expectedIcons = ["network", "video", "audio", "buffer"];
		dispose = render(() => <StatsPanel audio={mockAudioVideo.audio} video={mockAudioVideo.video} />, container);

		const items = container.querySelectorAll(".stats__item");
		items.forEach((item, index) => {
			expect(item.classList.contains(`stats__item--${expectedIcons[index]}`)).toBe(true);
		});
	});

	it("renders each item with icon wrapper", () => {
		dispose = render(() => <StatsPanel audio={mockAudioVideo.audio} video={mockAudioVideo.video} />, container);

		const wrappers = container.querySelectorAll(".stats__icon-wrapper");
		expect(wrappers.length).toBe(4);
	});

	it("renders each item with detail section", () => {
		dispose = render(() => <StatsPanel audio={mockAudioVideo.audio} video={mockAudioVideo.video} />, container);

		const details = container.querySelectorAll(".stats__item-detail");
		expect(details.length).toBe(4);
	});

	it("maintains correct DOM structure", () => {
		dispose = render(() => <StatsPanel audio={mockAudioVideo.audio} video={mockAudioVideo.video} />, container);

		const panel = container.querySelector(".stats__panel");
		const items = panel?.querySelectorAll(".stats__item");

		expect(panel?.children.length).toBe(4);
		items?.forEach((item) => {
			expect(item.querySelector(".stats__icon-wrapper")).toBeTruthy();
			expect(item.querySelector(".stats__item-detail")).toBeTruthy();
		});
	});
});
