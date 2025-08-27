import { Mutex } from "async-mutex";

// https://issues.chromium.org/issues/40504498
export const isChrome = navigator.userAgent.toLowerCase().includes("chrome");

// https://bugzilla.mozilla.org/show_bug.cgi?id=1967793
export const isFirefox = navigator.userAgent.toLowerCase().includes("firefox");

// Hacky workaround to support Webpack and Vite
// https://github.com/webpack/webpack/issues/11543#issuecomment-2045809214

// Note that Webpack needs to see `navigator.serviceWorker.register(new URL("literal"), ...)` for this to work

const loadAudioWorkletMutex = new Mutex();

export async function loadAudioWorklet(registerFn: () => Promise<ServiceWorkerRegistration>) {
	return await loadAudioWorkletMutex.runExclusive(async () => {
		const { register } = navigator.serviceWorker;

		// @ts-ignore hack to make webpack believe that it is registering a worker
		navigator.serviceWorker.register = (url: URL) => Promise.resolve(url);

		try {
			return (await registerFn()) as unknown as URL;
		} finally {
			navigator.serviceWorker.register = register;
		}
	});
}
