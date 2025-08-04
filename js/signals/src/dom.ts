import type { Effect } from ".";

type EventMap = HTMLElementEventMap;
type EventListeners = {
	[K in keyof EventMap]?: (event: EventMap[K]) => void;
};

export type CreateOptions<T extends HTMLElement> = {
	style?: Partial<CSSStyleDeclaration>;
	className?: string;
	classList?: string[];
	id?: string;
	textContent?: string;
	innerHTML?: string;
	dataset?: Record<string, string>;
	attributes?: Record<string, string>;
	events?: EventListeners;
} & Partial<Omit<T, "style" | "dataset">>;

export function create<K extends keyof HTMLElementTagNameMap>(
	tagName: K,
	options?: CreateOptions<HTMLElementTagNameMap[K] & HTMLElement>,
	...children: (HTMLElement | string)[]
): HTMLElementTagNameMap[K] {
	const element = document.createElement(tagName);

	if (!options) return element;

	const { style, classList, dataset, attributes, events, ...props } = options;

	// Apply styles
	if (style) {
		Object.assign(element.style, style);
	}

	// Apply class list
	if (classList) {
		element.classList.add(...classList);
	}

	// Apply dataset
	if (dataset) {
		Object.entries(dataset).forEach(([key, value]) => {
			element.dataset[key] = value;
		});
	}

	// Apply attributes
	if (attributes) {
		Object.entries(attributes).forEach(([key, value]) => {
			element.setAttribute(key, value);
		});
	}

	// Add event listeners
	if (events) {
		Object.entries(events).forEach(([event, handler]) => {
			element.addEventListener(event, handler as EventListener);
		});
	}

	// Append children
	if (children) {
		children.forEach((child) => {
			if (typeof child === "string") {
				element.appendChild(document.createTextNode(child));
			} else {
				element.appendChild(child);
			}
		});
	}

	// Apply other properties
	Object.assign(element, props);

	return element;
}

export type Render = (effect: Effect) => HTMLElement[] | HTMLElement | undefined;

export function render(parent: HTMLElement, effect: Effect, render: Render) {
	const element = render(effect);
	if (element instanceof HTMLElement) {
		parent.appendChild(element);
		effect.cleanup(() => element.remove());
	} else if (Array.isArray(element)) {
		const fragment = document.createDocumentFragment();
		element.forEach((child) => fragment.appendChild(child));
		parent.appendChild(fragment);
		effect.cleanup(() => parent.removeChild(fragment));
	}
}
