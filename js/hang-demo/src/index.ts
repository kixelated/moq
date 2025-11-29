import "./highlight";
import "@moq/hang-ui/watch/element";

import HangSupport from "@kixelated/hang/support/element";
import HangWatch from "@kixelated/hang/watch/element";
import HangStats from "@kixelated/hang/stats/element";

export { HangStats, HangSupport, HangWatch };

const watch = document.querySelector("hang-watch") as HangWatch | undefined;
if (!watch) throw new Error("unable to find <hang-watch> element");

// If query params are provided, use it as the broadcast path.
const urlParams = new URLSearchParams(window.location.search);
const path = urlParams.get("path");
if (path) {
	watch.setAttribute("path", path);
}
