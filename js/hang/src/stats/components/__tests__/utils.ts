/**
 * Test utilities for stats components
 * Common helpers for rendering and cleanup
 */

import { render as solidRender } from "solid-js/web";

/**
 * Helper to render a component and return the container
 * @param Component - SolidJS component to render
 * @returns Container element with rendered component
 */
export const renderComponent = (Component: () => any) => {
	const container = document.createElement("div");
	solidRender(() => Component(), container);
	return container;
};

/**
 * Helper to query an element with a specific class
 * @param container - Container element to search in
 * @param className - CSS class to search for
 * @returns Element or null
 */
export const getByClass = (container: Element, className: string) => {
	return container.querySelector(`.${className}`);
};

/**
 * Helper to get all elements with a specific class
 * @param container - Container element to search in
 * @param className - CSS class to search for
 * @returns NodeList of elements
 */
export const getAllByClass = (container: Element, className: string) => {
	return container.querySelectorAll(`.${className}`);
};

/**
 * Helper to simulate a click event
 * @param element - Element to click
 */
export const clickElement = (element: Element | null) => {
	element?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
};

/**
 * Helper to wait for next tick (component updates)
 */
export const waitForUpdate = () => {
	return new Promise((resolve) => setTimeout(resolve, 0));
};
