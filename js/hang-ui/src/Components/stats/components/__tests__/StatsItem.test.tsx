import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as registry from "../../handlers/registry";
import type { HandlerContext, HandlerProps, IStatsHandler } from "../../types";
import { StatsItem } from "../StatsItem";

vi.mock("../../handlers/registry", () => ({
	getHandlerClass: vi.fn(),
}));

// Mock audio and video props
const mockAudioVideo: HandlerProps = {
	audio: {
		source: {
			active: { peek: () => "audio-data" },
			config: { peek: () => ({ sampleRate: 48000, numberOfChannels: 2, bitrate: 128000, codec: "opus" }) },
			stats: { peek: () => ({ bytesReceived: 0 }) },
		},
	},
	video: {
		source: {
			display: { peek: () => ({ width: 1920, height: 1080 }) },
			syncStatus: { peek: () => ({ state: "ready" as const }) },
			bufferStatus: { peek: () => ({ state: "filled" as const }) },
			latency: { peek: () => 100 },
			stats: { peek: () => ({ frameCount: 0, timestamp: 0, bytesReceived: 0 }) },
		},
	},
};

describe("StatsItem", () => {
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
		vi.clearAllMocks();
	});

	it("renders with correct base structure", () => {
		vi.mocked(registry.getHandlerClass).mockReturnValue(undefined);

		dispose = render(() => <StatsItem icon="network" svg="<svg><circle r='5'></circle></svg>" />, container);

		const item = container.querySelector(".stats__item");
		expect(item).toBeTruthy();
		expect(item?.classList.contains("stats__item--network")).toBe(true);
	});

	it("renders icon wrapper with SVG content", () => {
		vi.mocked(registry.getHandlerClass).mockReturnValue(undefined);

		const testSvg = '<svg><circle r="5"></circle></svg>';
		dispose = render(() => <StatsItem icon="video" svg={testSvg} />, container);

		const iconWrapper = container.querySelector(".stats__icon-wrapper");
		expect(iconWrapper).toBeTruthy();

		const icon = container.querySelector(".stats__icon");
		expect(icon?.innerHTML).toBe(testSvg);
	});

	it("renders item detail with icon text", () => {
		vi.mocked(registry.getHandlerClass).mockReturnValue(undefined);

		dispose = render(() => <StatsItem icon="audio" svg="<svg></svg>" />, container);

		const iconText = container.querySelector(".stats__item-text");
		expect(iconText?.textContent).toBe("audio");
	});

	it("displays N/A when no handler is available", () => {
		vi.mocked(registry.getHandlerClass).mockReturnValue(undefined);

		dispose = render(() => <StatsItem icon="buffer" svg="<svg></svg>" />, container);

		const dataDisplay = container.querySelector(".stats__item-data");
		expect(dataDisplay?.textContent).toBe("N/A");
	});

	it("initializes handler with audio and video props", () => {
		const mockHandler: IStatsHandler = {
			setup: vi.fn(),
			cleanup: vi.fn(),
		};

		const MockHandlerClass = vi.fn(() => mockHandler) as ReturnType<typeof registry.getHandlerClass>;
		vi.mocked(registry.getHandlerClass).mockReturnValue(MockHandlerClass);

		dispose = render(
			() => (
				<StatsItem icon="network" svg="<svg></svg>" audio={mockAudioVideo.audio} video={mockAudioVideo.video} />
			),
			container,
		);

		expect(MockHandlerClass).toHaveBeenCalledWith(mockAudioVideo);
	});

	it("calls handler setup with setDisplayData callback", () => {
		const mockHandler: IStatsHandler = {
			setup: vi.fn(),
			cleanup: vi.fn(),
		};

		const MockHandlerClass = vi.fn(() => mockHandler) as ReturnType<typeof registry.getHandlerClass>;
		vi.mocked(registry.getHandlerClass).mockReturnValue(MockHandlerClass);

		dispose = render(
			() => (
				<StatsItem icon="video" svg="<svg></svg>" audio={mockAudioVideo.audio} video={mockAudioVideo.video} />
			),
			container,
		);

		expect(mockHandler.setup).toHaveBeenCalled();

		const setupCall = vi.mocked(mockHandler.setup).mock.calls[0][0] as HandlerContext;
		expect(setupCall.setDisplayData).toBeDefined();
		expect(typeof setupCall.setDisplayData).toBe("function");
	});

	it("updates display data when handler calls setDisplayData", () => {
		let capturedSetDisplayData: ((data: string) => void) | undefined;

		const mockHandler: IStatsHandler = {
			setup: vi.fn((context: HandlerContext) => {
				capturedSetDisplayData = context.setDisplayData;
			}),
			cleanup: vi.fn(),
		};

		const MockHandlerClass = vi.fn(() => mockHandler) as ReturnType<typeof registry.getHandlerClass>;
		vi.mocked(registry.getHandlerClass).mockReturnValue(MockHandlerClass);

		dispose = render(
			() => (
				<StatsItem icon="audio" svg="<svg></svg>" audio={mockAudioVideo.audio} video={mockAudioVideo.video} />
			),
			container,
		);

		expect(capturedSetDisplayData).toBeDefined();

		capturedSetDisplayData?.("42 kbps");

		const dataDisplay = container.querySelector(".stats__item-data");
		expect(dataDisplay?.textContent).toBe("42 kbps");
	});

	it("renders correct class for each icon type", () => {
		vi.mocked(registry.getHandlerClass).mockReturnValue(undefined);

		const icons = ["network", "video", "audio", "buffer"] as const;

		icons.forEach((icon) => {
			const testContainer = document.createElement("div");
			document.body.appendChild(testContainer);

			const testDispose = render(() => <StatsItem icon={icon} svg="<svg></svg>" />, testContainer);

			const item = testContainer.querySelector(".stats__item");
			expect(item?.classList.contains(`stats__item--${icon}`)).toBe(true);

			testDispose();
			document.body.removeChild(testContainer);
		});
	});

	it("cleans up previous handler before initializing new one", () => {
		const mockHandler1: IStatsHandler = {
			setup: vi.fn(),
			cleanup: vi.fn(),
		};

		const mockHandler2: IStatsHandler = {
			setup: vi.fn(),
			cleanup: vi.fn(),
		};

		const [icon, setIcon] = createSignal<"network" | "video">("network");

		const MockHandlerClass1 = vi.fn(() => mockHandler1) as ReturnType<typeof registry.getHandlerClass>;
		const MockHandlerClass2 = vi.fn(() => mockHandler2) as ReturnType<typeof registry.getHandlerClass>;

		let _callCount = 0;
		vi.mocked(registry.getHandlerClass).mockImplementation(() => {
			if (_callCount === 0) {
				_callCount++;
				return MockHandlerClass1;
			}
			return MockHandlerClass2;
		});

		dispose = render(
			() => (
				<StatsItem icon={icon()} svg="<svg></svg>" audio={mockAudioVideo.audio} video={mockAudioVideo.video} />
			),
			container,
		);

		expect(mockHandler1.setup).toHaveBeenCalled();

		_callCount = 0;
		vi.mocked(registry.getHandlerClass).mockReturnValue(MockHandlerClass2);

		setIcon("video");

		expect(mockHandler1.cleanup).toHaveBeenCalled();
		expect(mockHandler2.setup).toHaveBeenCalled();
	});

	it("maintains correct DOM hierarchy", () => {
		vi.mocked(registry.getHandlerClass).mockReturnValue(undefined);

		dispose = render(() => <StatsItem icon="network" svg="<svg></svg>" />, container);

		const item = container.querySelector(".stats__item");
		expect(item?.children.length).toBe(2);

		const iconWrapper = item?.querySelector(".stats__icon-wrapper");
		expect(iconWrapper).toBeTruthy();
		expect(iconWrapper?.children.length).toBe(1);

		const detail = item?.querySelector(".stats__item-detail");
		expect(detail).toBeTruthy();
		expect(detail?.children.length).toBe(2);

		expect(detail?.querySelector(".stats__item-text")).toBeTruthy();
		expect(detail?.querySelector(".stats__item-data")).toBeTruthy();
	});

	it("calls getHandlerClass with correct icon", () => {
		vi.mocked(registry.getHandlerClass).mockReturnValue(undefined);

		dispose = render(() => <StatsItem icon="buffer" svg="<svg></svg>" />, container);

		expect(registry.getHandlerClass).toHaveBeenCalledWith("buffer");
	});

	it("renders with dynamic SVG updates", () => {
		vi.mocked(registry.getHandlerClass).mockReturnValue(undefined);

		const [svg, setSvg] = createSignal("<svg><circle r='5'></circle></svg>");

		dispose = render(() => <StatsItem icon="network" svg={svg()} />, container);

		let icon = container.querySelector(".stats__icon");
		expect(icon?.innerHTML).toContain("circle");

		setSvg("<svg><rect width='10' height='10'></rect></svg>");

		icon = container.querySelector(".stats__icon");
		expect(icon?.innerHTML).toContain("rect");
		expect(icon?.innerHTML).not.toContain("circle");
	});
});
