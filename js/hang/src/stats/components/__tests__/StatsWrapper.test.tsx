/**
 * StatsWrapper component tests
 * Tests visibility state management and component composition
 */

import { describe, it, expect } from "vitest";
import { render } from "solid-js/web";
import { StatsWrapper } from "../StatsWrapper";

describe("StatsWrapper", () => {
    it("renders with wrapper class", () => {
        const container = document.createElement("div");

        render(() => <StatsWrapper />, container);

        const wrapper = container.querySelector(".stats__wrapper");
        expect(wrapper).toBeTruthy();
    });

    it("renders button component", () => {
        const container = document.createElement("div");

        render(() => <StatsWrapper />, container);

        const button = container.querySelector(".stats__toggle");
        expect(button).toBeTruthy();
    });

    it("initially hides stats panel", () => {
        const container = document.createElement("div");

        render(() => <StatsWrapper />, container);

        const panel = container.querySelector(".stats__panel");
        expect(panel).toBeFalsy();
    });

    it("has button with correct aria attributes", () => {
        const container = document.createElement("div");

        render(() => <StatsWrapper />, container);

        const button = container.querySelector("button");
        expect(button?.getAttribute("aria-pressed")).toBe("false");
        expect(button?.getAttribute("aria-label")).toBe("Show stats");
    });

    it("button has correct accessibility attributes", () => {
        const container = document.createElement("div");

        render(() => <StatsWrapper />, container);

        const button = container.querySelector("button");
        expect(button?.hasAttribute("aria-label")).toBe(true);
        expect(button?.hasAttribute("aria-pressed")).toBe(true);
    });

    it("renders with correct structure", () => {
        const container = document.createElement("div");

        render(() => <StatsWrapper />, container);

        const wrapper = container.querySelector(".stats__wrapper");
        const button = wrapper?.querySelector(".stats__toggle");

        expect(wrapper?.children.length).toBeGreaterThan(0);
        expect(button).toBeTruthy();
    });

    it("button is clickable", () => {
        const container = document.createElement("div");

        render(() => <StatsWrapper />, container);

        const button = container.querySelector("button") as HTMLElement;
        expect(() => button.click()).not.toThrow();
    });
});
