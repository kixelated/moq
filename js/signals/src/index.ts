import { dequal } from "dequal";

export type Dispose = () => void;

type Subscriber<T> = (value: T) => void;

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore depends on the bundler.
const dev = import.meta.env?.MODE !== "production";

export interface Getter<T> {
	peek(): T;
	subscribe(fn: Subscriber<T>): Dispose;
	readonly(): Computed<T>;
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

	readonly(): Computed<T> {
		return new Computed(this);
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

// Same as Signal but without the `set` method.
export class Computed<T> implements Getter<T> {
	#signal: Getter<T>;

	constructor(signal: Getter<T>) {
		this.#signal = signal;
	}

	peek(): T {
		return this.#signal.peek();
	}

	subscribe(fn: (value: T) => void): Dispose {
		return this.#signal.subscribe(fn);
	}

	readonly(): Computed<T> {
		return this;
	}
}

export class Root {
	// Sanity check to make sure roots are being disposed on dev.
	static #finalizer = new FinalizationRegistry<string>((debugInfo) => {
		console.warn(`Signals was garbage collected without being closed:\n${debugInfo}`);
	});

	#nested?: Effect[] = [];
	#dispose?: Dispose[] = [];

	constructor() {
		if (dev) {
			const debug = new Error("created here:").stack ?? "No stack";
			Root.#finalizer.register(this, debug, this);
		}
	}

	// Create a nested signals instance.
	effect(fn: (effect: Effect) => void) {
		if (this.#nested === undefined) {
			if (dev) {
				console.warn("Root.effect called when closed, ignoring");
			}
			return;
		}
		const signals = new Effect(fn);
		this.#nested.push(signals);
	}

	set<S extends Setter<unknown>>(
		signal: S,
		value: SetterType<S>,
		...args: undefined extends SetterType<S> ? [cleanup?: SetterType<S>] : [cleanup: SetterType<S>]
	): void {
		if (this.#dispose === undefined) {
			if (dev) {
				console.warn("Root.set called when closed, ignoring");
			}
			return;
		}
		const cleanup = args[0];
		const cleanupValue = cleanup === undefined ? (undefined as SetterType<S>) : cleanup;
		this.#dispose.push(() => signal.set(cleanupValue));
		signal.set(value);
	}

	// A helper to call a function when a signal changes.
	subscribe<T>(signal: Getter<T>, fn: (value: T) => void) {
		if (this.#nested === undefined) {
			if (dev) {
				console.warn("Root.subscribe called when closed, running once");
			}
			fn(signal.peek());
			return;
		}
		this.effect((effect) => {
			const value = effect.get(signal);
			fn(value);
		});
	}

	cleanup(fn: Dispose): void {
		if (this.#dispose === undefined) {
			if (dev) {
				console.warn("Root.cleanup called when closed, running immediately");
			}
			fn();
			return;
		}
		this.#dispose.push(fn);
	}

	close(): void {
		if (this.#dispose !== undefined) {
			for (const fn of this.#dispose) fn();
			this.#dispose = undefined;
		}

		if (this.#nested !== undefined) {
			for (const nested of this.#nested) nested.close();
			this.#nested = undefined;
		}

		this.#dispose = undefined;
		this.#nested = undefined;

		if (dev) {
			Root.#finalizer.unregister(this);
		}
	}
}

type SetterType<S> = S extends Setter<infer T> ? T : never;

// TODO Make this a single instance of an Effect, so close() can work correctly from async code.
export class Effect {
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore depends on the bundler.
	static dev = import.meta.env?.MODE !== "production";

	// Sanity check to make sure roots are being disposed on dev.
	static #finalizer = new FinalizationRegistry<string>((debugInfo) => {
		console.warn(`Signals was garbage collected without being closed:\n${debugInfo}`);
	});

	#fn: (effect: Effect) => void;
	#dispose?: Dispose[] = [];
	#unwatch: Dispose[] = [];
	#async: Promise<void>[] = [];

	#stack?: string;
	#scheduled = false;

	#stop!: () => void;
	#stopped: Promise<void>;

	constructor(fn: (effect: Effect) => void) {
		if (Effect.dev) {
			const debug = new Error("created here:").stack ?? "No stack";
			Effect.#finalizer.register(this, debug, this);
		}

		this.#fn = fn;

		if (Effect.dev) {
			this.#stack = new Error().stack;
		}

		this.#stopped = new Promise((resolve) => {
			this.#stop = resolve;
		});

		this.#schedule();
	}

	#schedule(): void {
		if (this.#scheduled) return;
		this.#scheduled = true;

		// We always queue a microtask to make it more difficult to get stuck in an infinite loop.
		queueMicrotask(() => this.#run());
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
			if (Effect.dev) {
				// There's a 1s timeout here to print warnings if cleanup functions don't exit.
				warn = setTimeout(() => {
					console.warn("spawn is still running after 1s", this.#stack);
				}, 1000);
			}
			await Promise.all(this.#async);
			if (warn) clearTimeout(warn);

			this.#async.length = 0;
		} catch (error) {
			console.error("async effect error", error);
			if (this.#stack) console.error("stack", this.#stack);
		}

		// Unsubscribe from all signals.
		for (const unwatch of this.#unwatch) unwatch();
		this.#unwatch.length = 0;

		// Run the cleanup functions for the previous run.
		for (const fn of this.#dispose) fn();
		this.#dispose.length = 0;

		// IMPORTANT: must run all of the dispose functions before unscheduling.
		// Otherwise, cleanup functions could get us stuck in an infinite loop.
		this.#scheduled = false;

		try {
			this.#fn(this);
		} catch (error) {
			console.error("effect error", error);
			if (this.#stack) console.error("stack", this.#stack);
		}
	}

	// Get the current value of a signal, monitoring it for changes (via ===) and rerunning on change.
	get<T>(signal: Getter<T>): T {
		if (this.#dispose === undefined) {
			if (Effect.dev) {
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
			if (Effect.dev) {
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
			if (Effect.dev) {
				console.warn("Effect.spawn called when closed");
			}

			return;
		}

		this.#async.push(promise);
	}

	// Run the function after the given delay in milliseconds UNLESS the effect is cleaned up first.
	timer(fn: () => void, ms: DOMHighResTimeStamp) {
		if (this.#dispose === undefined) {
			if (Effect.dev) {
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

	// Register a cleanup function.
	cleanup(fn: Dispose): void {
		if (this.#dispose === undefined) {
			if (Effect.dev) {
				console.warn("Effect.cleanup called when closed, running immediately");
			}

			fn();
			return;
		}

		this.#dispose.push(fn);
	}

	close(): void {
		if (this.#dispose === undefined) {
			if (Effect.dev) {
				console.warn("Effect.close called when closed, ignoring");
			}
			return;
		}

		this.#stop();

		for (const fn of this.#dispose) fn();
		this.#dispose = undefined;

		for (const signal of this.#unwatch) signal();
		this.#unwatch.length = 0;

		this.#async.length = 0;

		if (Effect.dev) {
			Effect.#finalizer.unregister(this);
		}
	}
}
