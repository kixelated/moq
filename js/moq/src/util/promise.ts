/**
 * Creates a deferred promise.
 *
 * @returns A deferred promise.
 */

export type Defer<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void };

export function defer<T>(): Defer<T> {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((r, rj) => {
		resolve = r;
		reject = rj;
	});
	return { promise, resolve, reject };
}
