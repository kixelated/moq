import { dequal } from "dequal";

export type Dispose = () => void;

type Subscriber<T> = (value: T) => void;

// @ts-ignore - Some environments don't recognize import.meta.env
const DEV = typeof import.meta.env !== "undefined" && import.meta.env?.MODE !== "production";

export interface Getter<T> {
	peek(): T;
	subscribe(fn: Subscriber<T>): Dispose;
}

export interface Setter<T> {
	set(value: T | ((prev: T) => T)): void;
}

export class Signal<T> implements Getter<T>, Setter<T> {
	#value: T;
	#subscribers: Set<Subscriber<T>> = new Set();

	constructor(value: T) {
		this.#value = value;
	}

	// TODO rename to get once we've ported everything
	peek(): T {
		return this.#value;
	}

	set(value: T | ((prev: T) => T)): void {
		let newValue: T;
		if (typeof value === "function") {
			newValue = (value as (prev: T) => T)(this.#value);
			// NOTE: We can't check for equality because the function could mutate the value.
		} else {
			// NOTE: This uses a more expensive dequal check to avoid spurious updates.
			// Other libraries use === but it's a massive footgun unless you're using primatives.
			if (dequal(value, this.#value)) {
				return;
			}
			newValue = value;
		}

		this.#value = newValue;

		for (const subscriber of this.#subscribers) {
			subscriber(newValue);
		}
	}

	// Mutate the current value and notify subscribers.
	update(fn: (prev: T) => void): void {
		fn(this.#value);
		this.set(this.#value);
	}

	// Receive a notification when the value changes.
	subscribe(fn: Subscriber<T>): Dispose {
		this.#subscribers.add(fn);
		return () => this.#subscribers.delete(fn);
	}

	// Receive a notification when the value changes AND with the current value.
	watch(fn: Subscriber<T>): Dispose {
		const dispose = this.subscribe(fn);
		try {
			fn(this.#value);
		} catch (e) {
			dispose();
			throw e;
		}
		return dispose;
	}
}

type SetterType<S> = S extends Setter<infer T> ? T : never;

// TODO Make this a single instance of an Effect, so close() can work correctly from async code.
export class Effect {
	// Sanity check to make sure roots are being disposed on dev.
	static #finalizer = new FinalizationRegistry<string>((debugInfo) => {
		console.warn(`Signals was garbage collected without being closed:\n${debugInfo}`);
	});

	#fn?: (effect: Effect) => void;
	#dispose?: Dispose[] = [];
	#unwatch: Dispose[] = [];
	#async: Promise<void>[] = [];

	#stack?: string;
	#scheduled = false;

	#stop!: () => void;
	#stopped: Promise<void>;

	// If a function is provided, it will be run with the effect as an argument.
	constructor(fn?: (effect: Effect) => void) {
		if (DEV) {
			const debug = new Error("created here:").stack ?? "No stack";
			Effect.#finalizer.register(this, debug, this);
		}

		this.#fn = fn;

		if (DEV) {
			this.#stack = new Error().stack;
		}

		this.#stopped = new Promise((resolve) => {
			this.#stop = resolve;
		});

		if (fn) {
			this.#schedule();
		}
	}

	#schedule(): void {
		if (this.#scheduled) return;
		this.#scheduled = true;

		// We always queue a microtask to make it more difficult to get stuck in an infinite loop.
		queueMicrotask(() =>
			this.#run().catch((error) => {
				console.error("effect error", error, this.#stack);
			}),
		);
	}

	async #run(): Promise<void> {
		if (this.#dispose === undefined) return; // closed, no error because this is a microtask

		this.#stop();
		this.#stopped = new Promise((resolve) => {
			this.#stop = resolve;
		});

		// Wait for all async effects to complete.
		try {
			let warn: ReturnType<typeof setTimeout> | undefined;
			const timeout = new Promise<void>((resolve) => {
				warn = setTimeout(() => {
					if (DEV) {
						console.warn("spawn is still running after 1s; continuing anyway", this.#stack);
					}

					resolve();
				}, 1000);
			});

			await Promise.race([Promise.all(this.#async), timeout]);
			if (warn) clearTimeout(warn);

			this.#async.length = 0;
		} catch (error) {
			console.error("async effect error", error);
			if (this.#stack) console.error("stack", this.#stack);
		}

		// We were closed while waiting for async effects to complete.
		if (this.#dispose === undefined) return;

		// Unsubscribe from all signals.
		for (const unwatch of this.#unwatch) unwatch();
		this.#unwatch.length = 0;

		// Run the cleanup functions for the previous run.
		for (const fn of this.#dispose) fn();
		this.#dispose.length = 0;

		// IMPORTANT: must run all of the dispose functions before unscheduling.
		// Otherwise, cleanup functions could get us stuck in an infinite loop.
		this.#scheduled = false;

		if (this.#fn) {
			this.#fn(this);
		}
	}

	// Get the current value of a signal, monitoring it for changes (via ===) and rerunning on change.
	get<T>(signal: Getter<T>): T {
		if (this.#dispose === undefined) {
			if (DEV) {
				console.warn("Effect.get called when closed, returning current value");
			}
			return signal.peek();
		}

		const value = signal.peek();
		const dispose = signal.subscribe(() => this.#schedule());

		this.#unwatch.push(dispose);
		return value;
	}

	// Temporarily set the value of a signal, unsetting it on cleanup.
	// The last argument is the cleanup value, set before the effect is rerun.
	// It's optional only if T can be undefined.
	set<S extends Setter<unknown>>(
		signal: S,
		value: SetterType<S>,
		...args: undefined extends SetterType<S> ? [cleanup?: SetterType<S>] : [cleanup: SetterType<S>]
	): void {
		if (this.#dispose === undefined) {
			if (DEV) {
				console.warn("Effect.set called when closed, ignoring");
			}
			return;
		}

		signal.set(value);
		const cleanup = args[0];
		const cleanupValue = cleanup === undefined ? (undefined as SetterType<S>) : cleanup;
		this.cleanup(() => signal.set(cleanupValue));
	}

	// TODO: Add effect for another layer of nesting

	// Spawn an async effect that blocks the effect being rerun until it completes.
	// The cancel promise is resolved when the effect should cleanup: on close or rerun.
	spawn(fn: (cancel: Promise<void>) => Promise<void>) {
		const promise = fn(this.#stopped);

		if (this.#dispose === undefined) {
			if (DEV) {
				console.warn("Effect.spawn called when closed");
			}

			return;
		}

		this.#async.push(promise);
	}

	// Run the function after the given delay in milliseconds UNLESS the effect is cleaned up first.
	timer(fn: () => void, ms: DOMHighResTimeStamp) {
		if (this.#dispose === undefined) {
			if (DEV) {
				console.warn("Effect.timer called when closed, ignoring");
			}
			return;
		}

		let timeout: ReturnType<typeof setTimeout> | undefined;
		timeout = setTimeout(() => {
			timeout = undefined;
			fn();
		}, ms);
		this.cleanup(() => timeout && clearTimeout(timeout));
	}

	// Run the function, and clean up the nested effect after the given delay.
	timeout(fn: (effect: Effect) => void, ms: DOMHighResTimeStamp) {
		if (this.#dispose === undefined) {
			if (DEV) {
				console.warn("Effect.timeout called when closed, ignoring");
			}
			return;
		}

		const effect = new Effect(fn);
		let timeout: ReturnType<typeof setTimeout> | undefined;

		timeout = setTimeout(() => {
			effect.close();
			timeout = undefined;
		}, ms);

		this.#dispose.push(() => {
			if (timeout) {
				clearTimeout(timeout);
				effect.close();
			}
		});
	}

	interval(fn: () => void, ms: DOMHighResTimeStamp) {
		if (this.#dispose === undefined) {
			if (DEV) {
				console.warn("Effect.interval called when closed, ignoring");
			}
			return;
		}

		const interval = setInterval(() => {
			fn();
		}, ms);
		this.cleanup(() => clearInterval(interval));
	}

	// Create a nested effect that can be rerun independently.
	effect(fn: (effect: Effect) => void) {
		if (this.#dispose === undefined) {
			if (DEV) {
				console.warn("Effect.nested called when closed, ignoring");
			}
			return;
		}

		const effect = new Effect(fn);
		this.#dispose.push(() => effect.close());
	}

	// A helper to call a function when a signal changes.
	subscribe<T>(signal: Getter<T>, fn: (value: T) => void) {
		if (this.#dispose === undefined) {
			if (DEV) {
				console.warn("Effect.subscribe called when closed, running once");
			}
			fn(signal.peek());
			return;
		}

		this.effect((effect) => {
			const value = effect.get(signal);
			fn(value);
		});
	}

	// Add an event listener that automatically removes on cleanup.
	event<K extends keyof HTMLElementEventMap>(
		target: HTMLElement,
		type: K,
		listener: (this: HTMLElement, ev: HTMLElementEventMap[K]) => void,
		options?: boolean | AddEventListenerOptions,
	): void;
	event<K extends keyof SVGElementEventMap>(
		target: SVGElement,
		type: K,
		listener: (this: SVGElement, ev: SVGElementEventMap[K]) => void,
		options?: boolean | AddEventListenerOptions,
	): void;
	event<K extends keyof DocumentEventMap>(
		target: Document,
		type: K,
		listener: (this: Document, ev: DocumentEventMap[K]) => void,
		options?: boolean | AddEventListenerOptions,
	): void;
	event<K extends keyof WindowEventMap>(
		target: Window,
		type: K,
		listener: (this: Window, ev: WindowEventMap[K]) => void,
		options?: boolean | AddEventListenerOptions,
	): void;
	event<K extends keyof WebSocketEventMap>(
		target: WebSocket,
		type: K,
		listener: (this: WebSocket, ev: WebSocketEventMap[K]) => void,
		options?: boolean | AddEventListenerOptions,
	): void;
	event<K extends keyof XMLHttpRequestEventMap>(
		target: XMLHttpRequest,
		type: K,
		listener: (this: XMLHttpRequest, ev: XMLHttpRequestEventMap[K]) => void,
		options?: boolean | AddEventListenerOptions,
	): void;
	event<K extends keyof MediaQueryListEventMap>(
		target: MediaQueryList,
		type: K,
		listener: (this: MediaQueryList, ev: MediaQueryListEventMap[K]) => void,
		options?: boolean | AddEventListenerOptions,
	): void;
	event<K extends keyof AnimationEventMap>(
		target: Animation,
		type: K,
		listener: (this: Animation, ev: AnimationEventMap[K]) => void,
		options?: boolean | AddEventListenerOptions,
	): void;
	event<K extends keyof EventSourceEventMap>(
		target: EventSource,
		type: K,
		listener: (this: EventSource, ev: EventSourceEventMap[K]) => void,
		options?: boolean | AddEventListenerOptions,
	): void;
	event(
		target: EventTarget,
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	): void;
	event(
		target: EventTarget,
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	): void {
		if (this.#dispose === undefined) {
			if (DEV) {
				console.warn("Effect.eventListener called when closed, ignoring");
			}
			return;
		}

		target.addEventListener(type, listener, options);
		this.cleanup(() => target.removeEventListener(type, listener, options));
	}

	// Reschedule the effect to run again.
	reload() {
		this.#schedule();
	}

	// Register a cleanup function.
	cleanup(fn: Dispose): void {
		if (this.#dispose === undefined) {
			if (DEV) {
				console.warn("Effect.cleanup called when closed, running immediately");
			}

			fn();
			return;
		}

		this.#dispose.push(fn);
	}

	proxy<T>(src: Getter<T>, dst: Setter<T>) {
		this.effect((effect) => {
			dst.set(effect.get(src));
		});
	}

	close(): void {
		if (this.#dispose === undefined) {
			return;
		}

		this.#stop();

		for (const fn of this.#dispose) fn();
		this.#dispose = undefined;

		for (const signal of this.#unwatch) signal();
		this.#unwatch.length = 0;

		this.#async.length = 0;

		if (DEV) {
			Effect.#finalizer.unregister(this);
		}
	}
}
