import { dequal } from "dequal";

export type Dispose = () => void;

export class Signal<T> {
	#value: T;
	#subscribers: Set<(value: T) => void> = new Set();

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
		} else {
			newValue = value;
		}

		if (newValue === this.#value) return;
		this.#value = newValue;

		for (const fn of this.#subscribers) fn(newValue);
	}

	readonly(): Computed<T> {
		return new Computed(this);
	}

	subscribe(fn: (value: T) => void): Dispose {
		this.#subscribers.add(fn);
		return () => this.#subscribers.delete(fn);
	}
}

// Same as Signal but without the `set` method.
export class Computed<T> {
	#signal: Signal<T>;

	constructor(signal: Signal<T>) {
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
	// eslint-disable-next-line @typescript-eslint/ban-ts-comment
	// @ts-ignore depends on the bundler.
	static dev = import.meta.env?.MODE !== "production";

	// Sanity check to make sure roots are being disposed on dev.
	static #finalizer = new FinalizationRegistry<string>((debugInfo) => {
		console.warn(`Signals was garbage collected without being closed:\n${debugInfo}`);
	});

	#nested?: Effect[] = [];
	#dispose?: Dispose[] = [];

	constructor() {
		if (Root.dev) {
			const debug = new Error("created here:").stack ?? "No stack";
			Root.#finalizer.register(this, debug, this);
		}
	}

	// Create a nested signals instance.
	effect(fn: (effect: Effect) => void) {
		if (this.#nested === undefined) throw new Error("closed");
		const signals = new Effect(fn);
		this.#nested.push(signals);
	}

	// A helper to call a function when a signal changes.
	subscribe<T>(signal: Signal<T> | Computed<T>, fn: (value: T) => void) {
		this.effect((effect) => {
			const value = effect.get(signal);
			fn(value);
		});
	}

	// Create a signal that is derived from other signals.
	computed<T>(fn: (effect: Effect) => T): Computed<T> {
		let signal: Signal<T> | undefined;

		this.effect((root) => {
			const value = fn(root);
			if (signal === undefined) {
				signal = new Signal(value);
			} else {
				signal.set(value);
			}
		});

		if (signal === undefined) {
			throw new Error("impossible: effect didn't run immediately");
		}

		return new Computed(signal);
	}

	// Same as `computed` but performs a deep equality check on the value.
	unique<T>(fn: (effect: Effect) => T): Computed<T> {
		let signal: Signal<T> | undefined;

		this.effect((root) => {
			const value = fn(root);
			if (signal === undefined) {
				signal = new Signal(value);
			} else if (!dequal(signal.peek(), value)) {
				signal.set(value);
			}
		});

		if (signal === undefined) {
			throw new Error("impossible: effect didn't run immediately");
		}

		return new Computed(signal);
	}

	cleanup(fn: Dispose): void {
		if (this.#dispose === undefined) throw new Error("closed");
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

		if (Root.dev) {
			Root.#finalizer.unregister(this);
		}
	}
}

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

	constructor(fn: (effect: Effect) => void) {
		if (Effect.dev) {
			const debug = new Error("created here:").stack ?? "No stack";
			Effect.#finalizer.register(this, debug, this);
		}

		this.#fn = fn;

		if (Effect.dev) {
			this.#stack = new Error().stack;
		}

		try {
			this.#fn(this);
		} catch (error) {
			console.error("effect error", error);
			if (this.#stack) console.error("stack", this.#stack);
		}
	}

	#schedule(): void {
		if (this.#scheduled) return;
		this.#scheduled = true;
		queueMicrotask(() => this.#run());
	}

	async #run(): Promise<void> {
		if (this.#dispose === undefined) return; // closed, no error because this is a microtask

		// Wait for all async effects to complete.
		// There's a 1s timeout here to catch cleanup functions that don't exit.
		try {
			const timeout = new Promise((reject) => setTimeout(() => reject(new Error("cleanup timeout")), 1000));
			await Promise.race([timeout, Promise.all(this.#async)]);
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

		this.#scheduled = false;

		try {
			this.#fn(this);
		} catch (error) {
			console.error("effect error", error);
			if (this.#stack) console.error("stack", this.#stack);
		}
	}

	// Get the current value of a signal, monitoring it for changes (via ===) and rerunning on change.
	get<T>(signal: Signal<T> | Computed<T>): T {
		if (this.#dispose === undefined) throw new Error("closed");

		const value = signal.peek();
		const dispose = signal.subscribe(() => this.#schedule());

		this.#unwatch.push(dispose);
		return value;
	}

	// Get the current value of a signal, monitoring it for changes (via dequal) and rerunning on change.
	unique<T>(signal: Signal<T> | Computed<T>): T {
		if (this.#dispose === undefined) throw new Error("closed");

		const value = signal.peek();
		const dispose = signal.subscribe((v) => {
			if (dequal(v, value)) return;
			this.#schedule();
		});

		this.#unwatch.push(dispose);
		return value;
	}

	// TODO: Add effect for another layer of nesting

	// Spawn an async effect that blocks the effect being rerun until it completes.
	// The cancel promise is resolved when the effect should cleanup: on close or rerun.
	spawn(fn: (cancel: Promise<void>) => Promise<void>) {
		const cancel = new Promise<void>((resolve) => {
			this.cleanup(() => resolve());
		});

		const promise = fn(cancel);
		this.#async.push(promise);
	}

	// Register a cleanup function.
	cleanup(fn: Dispose): void {
		if (this.#dispose === undefined) {
			fn();
			return;
		}

		this.#dispose.push(fn);
	}

	close(): void {
		if (this.#dispose === undefined) throw new Error("closed");
		for (const fn of this.#dispose) fn();
		this.#dispose = undefined;

		for (const signal of this.#unwatch) signal();
		this.#unwatch.length = 0;

		if (Effect.dev) {
			Effect.#finalizer.unregister(this);
		}
	}
}
