import { Effect, Signal } from "@kixelated/signals";
import * as DOM from "@kixelated/signals/dom";
import { isFirefox } from "../util/hacks";
import { type Codec, type Full, isSupported, type Partial, type SupportMode } from "./";

const OBSERVED = ["mode", "show", "details"] as const;
type Observed = (typeof OBSERVED)[number];

export default class HangSupport extends HTMLElement {
	#mode = new Signal<SupportMode>("all");
	#show = new Signal<Partial>("full");
	#details = new Signal<boolean>(false);
	#support = new Signal<Full | undefined>(undefined);
	#signals = new Effect();
	#close = new Signal<boolean>(false);

	static observedAttributes = OBSERVED;

	constructor() {
		super();

		isSupported().then((s) => this.#support.set(s));
		this.#signals.effect(this.#render.bind(this));
	}

	attributeChangedCallback(name: Observed, _oldValue: string | null, newValue: string | null) {
		if (name === "mode") {
			const mode = newValue ?? "all";

			if (mode === "core" || mode === "watch" || mode === "publish" || mode === "all") {
				this.mode = mode;
			} else {
				throw new Error(`Invalid mode: ${mode}`);
			}
		} else if (name === "show") {
			const show = newValue ?? "full";
			if (show === "full" || show === "partial" || show === "none") {
				this.show = show;
			} else {
				throw new Error(`Invalid show: ${show}`);
			}
		} else if (name === "details") {
			const details = newValue !== null;
			this.details = details;
		} else {
			const exhaustive: never = name;
			throw new Error(`Invalid attribute: ${exhaustive}`);
		}
	}

	get mode(): SupportMode {
		return this.#mode.peek();
	}

	set mode(mode: SupportMode) {
		this.#mode.set(mode);
	}

	get show(): Partial {
		return this.#show.peek();
	}

	set show(show: Partial) {
		this.#show.set(show);
	}

	get details(): boolean {
		return this.#details.peek();
	}

	set details(details: boolean) {
		this.#details.set(details);
	}

	disconnectedCallback() {
		this.#signals.close();
	}

	#render(effect: Effect) {
		const support = effect.get(this.#support);
		if (!support) return;

		const close = effect.get(this.#close);
		if (close) return;

		const mode = effect.get(this.#mode);
		const summary = this.#getSummary(support, mode);

		const show = effect.get(this.#show);
		switch (show) {
			case "partial":
				// Only show if have partial support
				if (summary === "full") return;
				break;
			case "none":
				// Only show if we don't support a features
				if (summary !== "none") return;
				break;
		}

		const container = DOM.create("div", {
			style: {
				margin: "0 auto",
				maxWidth: "28rem",
				padding: "1rem",
			},
		});

		this.appendChild(container);
		effect.cleanup(() => this.removeChild(container));

		this.#renderHeader(container, summary, effect);

		if (effect.get(this.#details)) {
			this.#renderSupportDetails(container, support, mode, effect);
		}
	}

	#getSummary(support: Full, mode: SupportMode): "full" | "partial" | "none" {
		const core = support.webtransport;
		if (core === "none" || mode === "core") return core;

		if (mode === "watch") {
			return this.#getWatchSupport(support);
		}

		if (mode === "publish") {
			return this.#getPublishSupport(support);
		}

		const watch = this.#getWatchSupport(support);
		const publish = this.#getPublishSupport(support);

		if (watch === "none" || publish === "none") return "none";
		if (watch === "partial" && publish === "partial") return "partial";

		return "full";
	}

	#getWatchSupport(support: Full): "full" | "partial" | "none" {
		if (!support.audio.decoding || !support.video.decoding) return "none";
		if (!support.audio.render || !support.video.render) return "none";

		if (!Object.values(support.audio.decoding).some((v) => v)) return "none";
		if (!Object.values(support.video.decoding).some((v) => v.software || v.hardware)) return "none";

		if (!Object.values(support.audio.decoding).every((v) => v)) return "partial";
		if (!Object.values(support.video.decoding).every((v) => v.software || v.hardware)) return "partial";

		return "full";
	}

	#getPublishSupport(support: Full): "full" | "partial" | "none" {
		if (!support.audio.encoding || !support.video.encoding) return "none";
		if (!support.audio.capture) return "none";

		if (!Object.values(support.audio.encoding).some((v) => v)) return "none";
		if (!Object.values(support.video.encoding).some((v) => v.software || v.hardware)) return "none";

		if (support.video.capture === "partial") return "partial";

		if (!Object.values(support.video.encoding).some((v) => v.hardware)) return "partial";

		return "full";
	}

	#renderHeader(parent: HTMLDivElement, summary: "full" | "partial" | "none", effect: Effect) {
		const headerDiv = DOM.create("div", {
			style: {
				display: "flex",
				flexDirection: "row",
				gap: "1rem",
				flexWrap: "wrap",
				justifyContent: "space-between",
				alignItems: "center",
			},
		});

		const statusDiv = DOM.create("div", {
			style: { fontWeight: "bold" },
		});

		if (summary === "full") {
			statusDiv.textContent = "🟢 Full Browser Support";
		} else if (summary === "partial") {
			statusDiv.textContent = "🟡 Partial Browser Support";
		} else if (summary === "none") {
			statusDiv.textContent = "🔴 No Browser Support";
		}

		const detailsButton = DOM.create("button", {
			type: "button",
			style: { fontSize: "14px" },
		});

		detailsButton.addEventListener("click", () => {
			this.#details.set((prev) => !prev);
		});

		effect.effect((effect) => {
			detailsButton.textContent = effect.get(this.#details) ? "Details ➖" : "Details ➕";
		});

		const closeButton = DOM.create(
			"button",
			{
				type: "button",
				style: { fontSize: "14px" },
			},
			"Close ❌",
		);

		closeButton.addEventListener("click", () => {
			this.#close.set(true);
		});

		headerDiv.appendChild(statusDiv);
		headerDiv.appendChild(detailsButton);
		headerDiv.appendChild(closeButton);

		parent.appendChild(headerDiv);
		effect.cleanup(() => parent.removeChild(headerDiv));
	}

	#renderSupportDetails(parent: HTMLDivElement, support: Full, mode: SupportMode, effect: Effect) {
		const container = DOM.create("div", {
			style: {
				display: "grid",
				gridTemplateColumns: "1fr 1fr 1fr",
				columnGap: "0.5rem",
				rowGap: "0.2rem",
				backgroundColor: "rgba(0, 0, 0, 0.6)",
				borderRadius: "0.5rem",
				padding: "1rem",
				fontSize: "0.875rem",
			},
		});

		const binary = (value: boolean | undefined) => (value ? "🟢 Yes" : "🔴 No");
		const hardware = (codec: Codec | undefined) =>
			codec?.hardware ? "🟢 Hardware" : codec?.software ? `🟡 Software${isFirefox ? "*" : ""}` : "🔴 No";
		const partial = (value: Partial | undefined) =>
			value === "full" ? "🟢 Full" : value === "partial" ? "🟡 Polyfill" : "🔴 None";

		const addRow = (label: string, col2: string, col3: string) => {
			const labelDiv = DOM.create(
				"div",
				{
					style: {
						gridColumnStart: "1",
						fontWeight: "bold",
						textAlign: "right",
					},
				},
				label,
			);

			const col2Div = DOM.create(
				"div",
				{
					style: {
						gridColumnStart: "2",
						textAlign: "center",
					},
				},
				col2,
			);

			const col3Div = DOM.create(
				"div",
				{
					style: { gridColumnStart: "3" },
				},
				col3,
			);

			container.appendChild(labelDiv);
			container.appendChild(col2Div);
			container.appendChild(col3Div);
		};

		addRow("WebTransport", "", partial(support.webtransport));

		if (mode !== "core") {
			if (mode !== "watch") {
				addRow("Capture", "Audio", binary(support.audio.capture));
				addRow("", "Video", partial(support.video.capture));
				addRow("Encoding", "Opus", partial(support.audio.encoding.opus));
				addRow("", "AAC", binary(support.audio.encoding.aac));
				addRow("", "AV1", hardware(support.video.encoding?.av1));
				addRow("", "H.265", hardware(support.video.encoding?.h265));
				addRow("", "H.264", hardware(support.video.encoding?.h264));
				addRow("", "VP9", hardware(support.video.encoding?.vp9));
				addRow("", "VP8", hardware(support.video.encoding?.vp8));
			}
			if (mode !== "publish") {
				addRow("Rendering", "Audio", binary(support.audio.render));
				addRow("", "Video", binary(support.video.render));
				addRow("Decoding", "Opus", partial(support.audio.decoding.opus));
				addRow("", "AAC", binary(support.audio.decoding.aac));
				addRow("", "AV1", hardware(support.video.decoding?.av1));
				addRow("", "H.265", hardware(support.video.decoding?.h265));
				addRow("", "H.264", hardware(support.video.decoding?.h264));
				addRow("", "VP9", hardware(support.video.decoding?.vp9));
				addRow("", "VP8", hardware(support.video.decoding?.vp8));
			}
			if (isFirefox) {
				const noteDiv = DOM.create(
					"div",
					{
						style: {
							gridColumnStart: "1",
							gridColumnEnd: "4",
							textAlign: "center",
							fontSize: "0.875rem",
							fontStyle: "italic",
						},
					},
					"Hardware acceleration is ",
					DOM.create(
						"a",
						{
							href: "https://github.com/w3c/webcodecs/issues/896",
						},
						"undetectable",
					),
					" on Firefox.",
				);
				container.appendChild(noteDiv);
			}
		}

		parent.appendChild(container);
		effect.cleanup(() => parent.removeChild(container));
	}
}

customElements.define("hang-support", HangSupport);

declare global {
	interface HTMLElementTagNameMap {
		"hang-support": HangSupport;
	}
}
