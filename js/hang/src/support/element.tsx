import { Signal } from "@kixelated/signals";
import solid from "@kixelated/signals/solid";
import { Accessor, JSX, Match, Show, Switch, createEffect, createMemo, createSelector, createSignal } from "solid-js";
import { render } from "solid-js/web";
import { Codec, Full, Partial, SupportRole, isSupported } from "./";

import { isFirefox } from "../hacks";

export default class HangSupport extends HTMLElement {
	#role = new Signal<SupportRole>("all");
	#show = new Signal<Partial>("full");
	#details = new Signal<boolean>(false);
	#support = new Signal<Full | undefined>(undefined);

	static get observedAttributes() {
		return ["role", "show", "details"];
	}

	constructor() {
		super();

		const role = solid(this.#role);
		const show = solid(this.#show);
		const details = solid(this.#details);
		const support = solid(this.#support);

		isSupported().then((s) => this.#support.set(s));

		render(
			() => (
				<Show when={support()}>
					{(support) => <Modal role={role} show={show} details={details} support={support} />}
				</Show>
			),
			this,
		);
	}

	attributeChangedCallback(name: string, _oldValue: string | null, newValue: string | null) {
		if (name === "role") {
			const role = newValue ?? "all";

			if (role === "core" || role === "watch" || role === "publish" || role === "all") {
				this.#role.set(role);
			} else {
				throw new Error(`Invalid role: ${role}`);
			}
		} else if (name === "show") {
			const show = newValue ?? "full";
			if (show === "full" || show === "partial" || show === "none") {
				this.#show.set(show);
			} else {
				throw new Error(`Invalid show: ${show}`);
			}
		} else if (name === "details") {
			const details = newValue !== null;
			this.#details.set(details);
		}
	}
}

customElements.define("hang-support", HangSupport);

declare global {
	interface HTMLElementTagNameMap {
		"hang-support": HangSupport;
	}
}

function SupportDetails(props: {
	support: Accessor<Full>;
	role: Accessor<"core" | "watch" | "publish" | "all">;
}) {
	const support = props.support();

	const c1: JSX.CSSProperties = {
		"grid-column-start": 1,
		"font-weight": "bold",
		"text-align": "right",
	};

	const c2: JSX.CSSProperties = {
		"grid-column-start": 2,
		"text-align": "center",
	};

	const c3 = {
		"grid-column-start": 3,
	};

	const binary = (value: boolean | undefined) => (value ? "🟢 Yes" : "🔴 No");
	const hardware = (codec: Codec | undefined) =>
		codec?.hardware ? "🟢 Hardware" : codec?.software ? `🟡 Software${isFirefox ? "*" : ""}` : "🔴 No";
	const partial = (value: Partial | undefined) =>
		value === "full" ? "🟢 Full" : value === "partial" ? "🟡 Partial" : "🔴 None";

	return (
		<Show when={support}>
			{(support) => (
				<div
					style={{
						display: "grid",
						"grid-template-columns": "1fr 1fr 1fr",
						"column-gap": "0.5rem",
						"row-gap": "0.2rem",
						"background-color": "rgba(0, 0, 0, 0.6)",
						"border-radius": "0.5rem",
						padding: "1rem",
						"font-size": "0.875rem",
					}}
				>
					<div style={c1}>WebTransport</div>
					<div style={c3}>{binary(support().webtransport)}</div>
					<Show when={props.role() !== "core"}>
						<Show when={props.role() !== "watch"}>
							<div style={c1}>Capture</div>
							<div style={c2}>Audio</div>
							<div style={c3}>{binary(support().audio.capture)}</div>
							<div style={c2}>Video</div>
							<div style={c3}>{partial(support().video.capture)}</div>
							<div style={c1}>Encoding</div>
							<div style={c2}>Opus</div>
							<div style={c3}>{binary(support().audio.encoding?.opus)}</div>
							<div style={c2}>AAC</div>
							<div style={c3}>{binary(support().audio.encoding?.aac)}</div>
							<div style={c2}>AV1</div>
							<div style={c3}>{hardware(support().video.encoding?.av1)}</div>
							<div style={c2}>H.265</div>
							<div style={c3}>{hardware(support().video.encoding?.h265)}</div>
							<div style={c2}>H.264</div>
							<div style={c3}>{hardware(support().video.encoding?.h264)}</div>
							<div style={c2}>VP9</div>
							<div style={c3}>{hardware(support().video.encoding?.vp9)}</div>
							<div style={c2}>VP8</div>
							<div style={c3}>{hardware(support().video.encoding?.vp8)}</div>
						</Show>
						<Show when={props.role() !== "publish"}>
							<div style={c1}>Rendering</div>
							<div style={c2}>Audio</div>
							<div style={c3}>{binary(support().audio.render)}</div>
							<div style={c2}>Video</div>
							<div style={c3}>{binary(support().video.render)}</div>
							<div style={c1}>Decoding</div>
							<div style={c2}>Audio</div>
							<div style={c3}>{binary(support().audio.decoding?.opus)}</div>
							<div style={c2}>AAC</div>
							<div style={c3}>{binary(support().audio.decoding?.aac)}</div>
							<div style={c2}>AV1</div>
							<div style={c3}>{hardware(support().video.decoding?.av1)}</div>
							<div style={c2}>H.265</div>
							<div style={c3}>{hardware(support().video.decoding?.h265)}</div>
							<div style={c2}>H.264</div>
							<div style={c3}>{hardware(support().video.decoding?.h264)}</div>
							<div style={c2}>VP9</div>
							<div style={c3}>{hardware(support().video.decoding?.vp9)}</div>
							<div style={c2}>VP8</div>
							<div style={c3}>{hardware(support().video.decoding?.vp8)}</div>
						</Show>
						<Show when={isFirefox}>
							<div
								style={{
									"grid-column-start": 1,
									"grid-column-end": 4,
									"text-align": "center",
									"font-size": "0.875rem",
									"font-style": "italic",
								}}
							>
								* Hardware acceleration is{" "}
								<a href="https://github.com/w3c/webcodecs/issues/896">undetectable</a> on Firefox.
							</div>
						</Show>
					</Show>
				</div>
			)}
		</Show>
	);
}

function Modal(props: {
	role: Accessor<SupportRole>;
	show: Accessor<Partial>;
	details: Accessor<boolean>;
	support: Accessor<Full>;
}) {
	const core = createMemo<"full" | "none" | undefined>(() => {
		if (!props.support().webtransport) return "none";
		return "full";
	});

	const watch = createMemo<"full" | "partial" | "none" | undefined>(() => {
		const s = props.support();
		if (!s.audio.decoding || !s.video.decoding) return "none";
		if (!s.audio.render || !s.video.render) return "none";

		// Make sure we support decoding at least one codec of each type...
		if (!Object.values(s.audio.decoding).some((v) => v)) return "none";
		if (!Object.values(s.video.decoding).some((v) => v.software || v.hardware)) return "none";

		// Check if we support decoding all codecs.
		if (!Object.values(s.audio.decoding).every((v) => v)) return "partial";
		if (!Object.values(s.video.decoding).every((v) => v.software || v.hardware)) return "partial";

		return "full";
	});

	const publish = createMemo<"full" | "partial" | "none" | undefined>(() => {
		const s = props.support();

		if (!s.audio.encoding || !s.video.encoding) return "none";
		if (!s.audio.capture) return "none";

		// Make sure that we support encoding at least one codec of each type...
		if (!Object.values(s.audio.encoding).some((v) => v)) return "none";
		if (!Object.values(s.video.encoding).some((v) => v.software || v.hardware)) return "none";

		// There's a polyfill for when MediaStreamTrackProcessor that is kinda gross.
		if (s.video.capture === "partial") return "partial";

		// Make sure we support encoding at least one codec with hardware acceleration.
		if (!Object.values(s.video.encoding).some((v) => v.hardware)) return "partial";

		return "full";
	});

	const final = createMemo<"full" | "partial" | "none" | undefined>(() => {
		const b = core();
		if (b === "none" || props.role() === "core") return b;

		if (props.role() === "watch") {
			return watch();
		}

		if (props.role() === "publish") {
			return publish();
		}

		const w = watch();
		const p = publish();

		if (w === "none" || p === "none") return "none";
		if (w === "partial" && p === "partial") return "partial";

		return "full";
	});

	const isFinal = createSelector(final);
	const [showDetails, setShowDetails] = createSignal<boolean>(props.details());
	createEffect(() => {
		setShowDetails(props.details());
	});

	const [close, setClose] = createSignal<boolean>(false);

	// Only render based on the result.
	const shouldShow = () => {
		if (close()) return false;
		if (props.show() === "full") return true;
		if (props.show() === "partial") return isFinal("partial") || isFinal("none");
		return isFinal("none");
	};

	return (
		<Show when={shouldShow()}>
			<div style={{ margin: "0 auto", "max-width": "28rem", padding: "1rem" }}>
				<div
					style={{
						display: "flex",
						"flex-direction": "row",
						gap: "1rem",
						"flex-wrap": "wrap",
						"justify-content": "space-between",
						"align-items": "center",
					}}
				>
					<div style={{ "font-weight": "bold" }}>
						<Switch>
							<Match when={isFinal("full")}>🟢 Full Browser Support</Match>
							<Match when={isFinal("partial")}>🟡 Partial Browser Support</Match>
							<Match when={isFinal("none")}>🔴 No Browser Support</Match>
						</Switch>
					</div>
					<button type="button" onClick={() => setShowDetails((d) => !d)} style={{ "font-size": "14px" }}>
						{showDetails() ? "Details ➖" : "Details ➕"}
					</button>
					<button type="button" onClick={() => setClose(true)} style={{ "font-size": "14px" }}>
						Close ❌
					</button>
				</div>
				<Show when={showDetails()}>
					<SupportDetails support={props.support} role={props.role} />
				</Show>
			</div>
		</Show>
	);
}
