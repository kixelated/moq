import * as Comlink from "comlink";
import { marked } from "marked";

// Create a markdown renderer that opens links in a new tab.
const renderer = new marked.Renderer();

renderer.link = ({ href, title, text }) => {
	const t = title ? ` title="${title}"` : "";
	const safeHref = href ?? "#";
	// Important: target="_blank" rel="noopener noreferrer"
	return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer"${t}>${text}</a>`;
};

marked.use({ renderer });

export default marked.parse; // just for types
Comlink.expose(marked.parse);
