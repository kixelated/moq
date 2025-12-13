import { render } from "solid-js/web";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { StatsContext } from "../../context";
import type { HandlerProps } from "../../types";
import { StatsWrapper } from "../StatsWrapper";

const mockAudioVideo: HandlerProps = {
	audio: { source: { active: { peek: () => "audio-data" } } },
	video: { source: { display: { peek: () => ({ width: 1920, height: 1080 }) } } },
};

describe("StatsWrapper", () => {
	let container: HTMLDivElement;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.appendChild(container);
	});

	afterEach(() => {
		document.body.removeChild(container);
	});

	it("renders with wrapper class", () => {
		render(
			() => (
				<StatsContext.Provider value={mockAudioVideo}>
					<StatsWrapper />
				</StatsContext.Provider>
			),
			container,
		);

		const wrapper = container.querySelector(".stats__wrapper");
		expect(wrapper).toBeTruthy();
	});

	it("renders button component", () => {
		render(
			() => (
				<StatsContext.Provider value={mockAudioVideo}>
					<StatsWrapper />
				</StatsContext.Provider>
			),
			container,
		);

		const button = container.querySelector(".stats__button");
		expect(button).toBeTruthy();
	});

	it("initially hides stats panel", () => {
		render(
			() => (
				<StatsContext.Provider value={mockAudioVideo}>
					<StatsWrapper />
				</StatsContext.Provider>
			),
			container,
		);

		const panel = container.querySelector(".stats__panel");
		expect(panel).toBeFalsy();
	});

	it("has button with correct aria attributes", () => {
		render(
			() => (
				<StatsContext.Provider value={mockAudioVideo}>
					<StatsWrapper />
				</StatsContext.Provider>
			),
			container,
		);

		const button = container.querySelector("button");
		expect(button?.getAttribute("aria-pressed")).toBe("false");
		expect(button?.getAttribute("aria-label")).toBe("Show stats");
	});

	it("button has correct accessibility attributes", () => {
		render(
			() => (
				<StatsContext.Provider value={mockAudioVideo}>
					<StatsWrapper />
				</StatsContext.Provider>
			),
			container,
		);

		const button = container.querySelector("button");
		expect(button?.hasAttribute("aria-label")).toBe(true);
		expect(button?.hasAttribute("aria-pressed")).toBe(true);
	});

	it("renders with correct structure", () => {
		render(
			() => (
				<StatsContext.Provider value={mockAudioVideo}>
					<StatsWrapper />
				</StatsContext.Provider>
			),
			container,
		);

		const wrapper = container.querySelector(".stats__wrapper");
		const button = wrapper?.querySelector(".stats__button");

		expect(wrapper).toBeTruthy();
		expect(button).toBeTruthy();
	});

	it("button is clickable", () => {
		render(
			() => (
				<StatsContext.Provider value={mockAudioVideo}>
					<StatsWrapper />
				</StatsContext.Provider>
			),
			container,
		);

		const button = container.querySelector("button") as HTMLElement;
		expect(button).toBeTruthy();
		expect(button?.tagName).toBe("BUTTON");
	});
});
