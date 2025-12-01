/**
 * StatsItem component tests
 * Tests metric display, styling, and data rendering
 */

import { describe, it, expect } from "vitest";
import { render } from "solid-js/web";
import { StatsItem } from "../StatsItem";

describe("StatsItem", () => {
    const testSvg = "<svg><circle r='5'></circle></svg>";

    it("renders with correct base classes", () => {
        const container = document.createElement("div");

        render(
            () => <StatsItem icon="network" svg={testSvg} />,
            container
        );

        const item = container.querySelector(".stats__item");
        expect(item).toBeTruthy();
        expect(item?.classList.contains("stats__item--network")).toBe(true);
    });

    it("renders all icon types with correct modifiers", () => {
        const icons = ["network", "video", "audio", "buffer"] as const;

        icons.forEach((icon) => {
            const container = document.createElement("div");

            render(
                () => <StatsItem icon={icon} svg={testSvg} />,
                container
            );

            const item = container.querySelector(".stats__item");
            expect(item?.classList.contains(`stats__item--${icon}`)).toBe(
                true
            );
        });
    });

    it("renders icon wrapper with correct structure", () => {
        const container = document.createElement("div");

        render(
            () => <StatsItem icon="network" svg={testSvg} />,
            container
        );

        const iconWrapper = container.querySelector(".stats__icon-wrapper");
        const icon = iconWrapper?.querySelector(".stats__icon");

        expect(iconWrapper).toBeTruthy();
        expect(icon).toBeTruthy();
        expect(icon?.innerHTML).toContain("<circle");
    });

    it("renders detail section with label and data", () => {
        const container = document.createElement("div");

        render(
            () => <StatsItem icon="network" svg={testSvg} />,
            container
        );

        const detail = container.querySelector(".stats__item-detail");
        const label = detail?.querySelector(".stats__item-text");
        const data = detail?.querySelector(".stats__item-data");

        expect(detail).toBeTruthy();
        expect(label?.textContent).toBe("network");
        expect(data?.textContent).toBe("N/A");
    });

    it("displays correct icon label for each type", () => {
        const icons = ["network", "video", "audio", "buffer"] as const;

        icons.forEach((icon) => {
            const container = document.createElement("div");

            render(
                () => <StatsItem icon={icon} svg={testSvg} />,
                container
            );

            const label = container.querySelector(".stats__item-text");
            expect(label?.textContent).toBe(icon);
        });
    });

    it("renders with correct CSS class hierarchy", () => {
        const container = document.createElement("div");

        render(
            () => <StatsItem icon="video" svg={testSvg} />,
            container
        );

        const item = container.querySelector(".stats__item");
        const wrapper = item?.querySelector(".stats__icon-wrapper");
        const icon = wrapper?.querySelector(".stats__icon");
        const detail = item?.querySelector(".stats__item-detail");

        expect(item).toBeTruthy();
        expect(wrapper).toBeTruthy();
        expect(icon).toBeTruthy();
        expect(detail).toBeTruthy();

        if (item && wrapper && icon && detail) {
            expect(item.contains(wrapper)).toBe(true);
            expect(wrapper.contains(icon)).toBe(true);
            expect(item.contains(detail)).toBe(true);
        }
    });
});
