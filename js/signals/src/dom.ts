import type { Effect } from ".";

export type CreateOptions<T extends HTMLElement> = {
	style?: Partial<CSSStyleDeclaration>;
	className?: string;
	classList?: string[];
	id?: string;
	dataset?: Record<string, string>;
	attributes?: Record<string, string>;
} & Partial<Omit<T, "style" | "dataset">>;

export function create<K extends keyof HTMLElementTagNameMap>(
	tagName: K,
	options?: CreateOptions<HTMLElementTagNameMap[K] & HTMLElement>,
	...children: (HTMLElement | string)[]
): HTMLElementTagNameMap[K] {
	const element = document.createElement(tagName);

	if (!options) return element;

	const { style, classList, dataset, attributes, ...props } = options;

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

// Matches solid.js's JSX.Element type.
export type Element = Node | ArrayElement | (string & {}) | number | boolean | null | undefined;
interface ArrayElement extends Array<Element> {}

export function render(effect: Effect, parent: Node, element: Element | ((effect: Effect) => Element)) {
	const e = typeof element === "function" ? element(effect) : element;
	if (e === undefined || e === null) return;

	let node: Node;
	if (e instanceof Node) {
		node = e;
	} else if (Array.isArray(e)) {
		node = document.createDocumentFragment();
		for (const child of e) {
			render(effect, node, child);
		}
	} else if (typeof e === "number" || typeof e === "boolean" || typeof e === "string") {
		node = document.createTextNode(e.toString());
	} else {
		const exhaustive: never = e;
		throw new Error(`Invalid element type: ${exhaustive}`);
	}

	parent.appendChild(node);
	effect.cleanup(() => {
		try {
			parent.removeChild(node);
		} catch (e) {
			console.log("cleanup failed", parent, node);
			throw e;
		}
	});
}

export function setClass(effect: Effect, element: HTMLElement, ...classNames: string[]) {
	for (const className of classNames) {
		element.classList.add(className);
	}

	effect.cleanup(() => {
		for (const className of classNames) {
			element.classList.remove(className);
		}
	});
}
