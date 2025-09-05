let loading: Promise<boolean> | undefined;

// Returns true when the polyfill is loaded.
export async function polyfill(): Promise<boolean> {
	if (globalThis.AudioEncoder && globalThis.AudioDecoder) {
		return true;
	}

	if (!loading) {
		console.warn("using Opus polyfill; performance may be degraded");

		// Load the polyfill and the libav variant we're using.
		// TODO build with AAC support.
		// NOTE: we use require here to avoid tsc errors with libavjs-webcodecs-polyfill.
		loading = Promise.all([import("@libav.js/variant-opus"), import("libavjs-webcodecs-polyfill")]).then(
			async ([opus, libav]) => {
				await libav.load({
					LibAV: opus,
					polyfill: true,
				});
				return true;
			},
		);
	}
	return await loading;
}
