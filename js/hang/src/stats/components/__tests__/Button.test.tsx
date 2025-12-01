/**
 * Button component tests
 * Tests toggle button functionality, accessibility, and state management
 */

import { describe, it, expect } from "vitest";
import { render } from "solid-js/web";
import { createSignal } from "solid-js";
import { Button } from "../Button";

describe("Button", () => {
    it("renders with correct initial classes", () => {
        const onToggle = () => { };
        const container = document.createElement("div");

        render(
            () => (
                <Button isVisible={false} onToggle={onToggle} icon="<svg></svg>" />
            ),
            container
        );

        const button = container.querySelector("button");
        expect(button).toBeTruthy();
        expect(button?.classList.contains("stats__toggle")).toBe(true);
    });

    it("renders button element", () => {
        const onToggle = () => { };
        const container = document.createElement("div");

        render(
            () => (
                <Button isVisible={false} onToggle={onToggle} icon="<svg></svg>" />
            ),
            container
        );

        const button = container.querySelector("button");
        expect(button?.tagName).toBe("BUTTON");
    });

    it("renders with correct aria attributes when hidden", () => {
        const onToggle = () => { };
        const container = document.createElement("div");

        render(
            () => (
                <Button isVisible={false} onToggle={onToggle} icon="<svg></svg>" />
            ),
            container
        );

        const button = container.querySelector("button");
        expect(button?.getAttribute("aria-label")).toBe("Show stats");
        expect(button?.getAttribute("aria-pressed")).toBe("false");
    });

    it("renders with correct aria attributes when visible", () => {
        const onToggle = () => { };
        const container = document.createElement("div");

        render(
            () => (
                <Button isVisible={true} onToggle={onToggle} icon="<svg></svg>" />
            ),
            container
        );

        const button = container.querySelector("button");
        expect(button?.getAttribute("aria-label")).toBe("Hide stats");
        expect(button?.getAttribute("aria-pressed")).toBe("true");
    });

    it("updates aria attributes when visibility changes", () => {
        const onToggle = () => { };
        const [isVisible, setIsVisible] = createSignal(false);
        const container = document.createElement("div");

        render(
            () => (
                <Button isVisible={isVisible()} onToggle={onToggle} icon="<svg></svg>" />
            ),
            container
        );

        const button = container.querySelector("button");
        expect(button?.getAttribute("aria-pressed")).toBe("false");

        setIsVisible(true);

        expect(button?.getAttribute("aria-pressed")).toBe("true");
    });

    it("renders icon correctly", () => {
        const onToggle = () => { };
        const testIcon = "<svg><circle r='5'></circle></svg>";
        const container = document.createElement("div");

        render(
            () => (
                <Button
                    isVisible={false}
                    onToggle={onToggle}
                    icon={testIcon}
                />
            ),
            container
        );

        const iconDiv = container.querySelector(".stats__icon");
        expect(iconDiv?.innerHTML).toContain("<circle");
    });

    it("has correct title attribute", () => {
        const onToggle = () => { };
        const container = document.createElement("div");

        render(
            () => (
                <Button isVisible={false} onToggle={onToggle} icon="<svg></svg>" />
            ),
            container
        );

        const button = container.querySelector("button");
        expect(button?.getAttribute("title")).toBe("Show stats");
    });
});
