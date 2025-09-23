import type * as Moq from "@kixelated/moq";
import { Effect, Signal } from "@kixelated/signals";
import * as Time from "./time";

export interface Source {
	byteLength: number;
	copyTo(buffer: Uint8Array): void;
}

export interface Frame {
	data: Uint8Array;
	timestamp: Time.Micro;
	keyframe: boolean;
	group: number;
}

export function encode(source: Uint8Array | Source, timestamp: Time.Micro): Uint8Array {
	// TODO switch over to u64 for simplicity. The varint uses 8 bytes anyway after 18 minutes lul.
	// TODO Don't encode into one buffer. Write the header/payload separately to avoid reallocating.
	const data = new Uint8Array(8 + (source instanceof Uint8Array ? source.byteLength : source.byteLength));

	const size = setVint53(data, timestamp).byteLength;
	if (source instanceof Uint8Array) {
		data.set(source, size);
	} else {
		source.copyTo(data.subarray(size));
	}
	return data.subarray(0, (source instanceof Uint8Array ? source.byteLength : source.byteLength) + size);
}

// NOTE: A keyframe is always the first frame in a group, so it's not encoded on the wire.
export function decode(buffer: Uint8Array): { data: Uint8Array; timestamp: Time.Micro } {
	const [us, data] = getVint53(buffer);
	const timestamp = us as Time.Micro;
	return { timestamp, data };
}

export class Producer {
	#track: Moq.Track;
	#group?: Moq.Group;

	constructor(track: Moq.Track) {
		this.#track = track;
	}

	encode(data: Uint8Array | Source, timestamp: Time.Micro, keyframe: boolean) {
		if (keyframe) {
			this.#group?.close();
			this.#group = this.#track.appendGroup();
		} else if (!this.#group) {
			throw new Error("must start with a keyframe");
		}

		this.#group?.writeFrame(encode(data, timestamp));
	}

	close() {
		this.#track.close();
		this.#group?.close();
	}
}

export interface ConsumerProps {
	// Target latency in milliseconds (default: 0)
	latency?: Signal<Time.Milli> | Time.Milli;
}

export class Consumer {
	#track: Moq.Track;
	#latency: Signal<Time.Milli>;
	#groups: Moq.Group[] = [];
	#active = 0; // the active group sequence number
	#frames: Frame[] = [];
	#prev?: Time.Micro;

	// Wake up the consumer when a new frame is available.
	#notify?: () => void;

	#signals = new Effect();

	constructor(track: Moq.Track, props?: ConsumerProps) {
		this.#track = track;
		this.#latency = Signal.from(props?.latency ?? Time.Milli.zero);

		this.#signals.spawn(this.#run.bind(this));
		this.#signals.cleanup(() => {
			this.#track.close();
			for (const group of this.#groups) {
				group.close();
			}
			this.#groups.length = 0;
		});
	}

	async #run() {
		// Start fetching groups in the background
		for (;;) {
			const group = await this.#track.nextGroup();
			if (!group) break;

			if (group.sequence < this.#active) {
				console.warn(`skipping old group: ${group.sequence} < ${this.#active}`);
				// Skip old groups.
				group.close();
				continue;
			}

			// Insert into #groups based on the group sequence number (ascending).
			// This is used to cancel old groups.
			this.#groups.push(group);
			this.#groups.sort((a, b) => a.sequence - b.sequence);

			// Start buffering frames from this group
			this.#signals.spawn(this.#runGroup.bind(this, group));
		}
	}

	async #runGroup(group: Moq.Group) {
		try {
			let keyframe = true;

			for (;;) {
				const next = await group.readFrame();
				if (!next) break;

				// Check if we were skipped already.
				if (group.sequence < this.#active) break;

				const { data, timestamp } = decode(next);
				const frame = {
					data,
					timestamp,
					keyframe,
					group: group.sequence,
				};

				keyframe = false;

				// Store frames in buffer in order.
				if (this.#frames.length === 0 || frame.timestamp >= this.#frames[this.#frames.length - 1].timestamp) {
					// Already sorted; most of the time we just append to the end.
					this.#frames.push(frame);
				} else {
					this.#frames.push(frame);
					this.#frames.sort((a, b) => a.timestamp - b.timestamp);
				}

				const first = this.#frames.at(0);

				if (first && first.group <= this.#active) {
					if (this.#notify) {
						this.#notify();
						this.#notify = undefined;
					}
				} else {
					// Check for latency violations
					this.#checkLatency();
				}
			}
		} catch (_err) {
			// Ignore errors, we close groups on purpose to skip them.
		} finally {
			if (group.sequence === this.#active) {
				// Advance to the next group.
				// We don't use #skipTo because we don't want to drop the last frames.
				this.#active += 1;

				if (this.#notify && this.#frames.at(0)?.group === this.#active) {
					this.#notify();
					this.#notify = undefined;
				}
			}

			group.close();
		}
	}

	#checkLatency() {
		if (this.#frames.length < 2) return;

		// Check if we have at least #latency frames in the queue.
		const first = this.#frames[0];
		const last = this.#frames[this.#frames.length - 1];

		const latency = last.timestamp - first.timestamp;
		if (latency < Time.Micro.fromMilli(this.#latency.peek())) return;

		// Skip to the next group
		const nextFrame = this.#frames.find((f) => f.group > this.#active);
		if (!nextFrame) return; // Within the same group, ignore for now

		if (this.#prev) {
			console.warn(`skipping ahead: ${Math.round((nextFrame.timestamp - this.#prev) / 1000)}ms`);
		}

		this.#skipTo(nextFrame.group);
	}

	#skipTo(groupId: number) {
		this.#active = groupId;

		// Skip old groups.
		while (this.#groups.length > 0 && this.#groups[0].sequence < this.#active) {
			this.#groups.shift()?.close();
		}

		// Skip old frames.
		let dropped = 0;
		while (this.#frames.length > 0 && this.#frames[0].group < this.#active) {
			dropped++;
			this.#frames.shift();
		}

		if (dropped > 0) {
			console.warn(`dropped ${dropped} frames while skipping`);
		}

		if (this.#notify && this.#frames.at(0)?.group === this.#active) {
			this.#notify();
			this.#notify = undefined;
		}
	}

	async decode(): Promise<Frame | undefined> {
		for (;;) {
			// Check if we have frames from the active group
			if (this.#frames.length > 0) {
				if (this.#frames[0].group <= this.#active) {
					const next = this.#frames.shift();
					this.#prev = next?.timestamp;
					return next;
				}

				// We have frames but not from the active group
				// Check if we should move to the next group
				const nextGroupFrames = this.#frames.filter((f) => f.group > this.#active);
				if (nextGroupFrames.length > 0) {
					// Move to the next group
					const nextGroup = Math.min(...nextGroupFrames.map((f) => f.group));
					this.#skipTo(nextGroup);
					continue;
				}
			}

			if (this.#notify) {
				throw new Error("multiple calls to decode not supported");
			}

			const wait = new Promise<void>((resolve) => {
				this.#notify = resolve;
			}).then(() => true);

			if (!(await Promise.race([wait, this.#signals.closed]))) {
				this.#notify = undefined;
				// Consumer was closed while waiting for a new frame.
				return undefined;
			}
		}
	}

	close(): void {
		this.#signals.close();

		for (const group of this.#groups) {
			group.close();
		}

		this.#groups = [];
		this.#frames = [];
	}
}

const MAX_U6 = 2 ** 6 - 1;
const MAX_U14 = 2 ** 14 - 1;
const MAX_U30 = 2 ** 30 - 1;
const MAX_U53 = Number.MAX_SAFE_INTEGER;
//const MAX_U62: bigint = 2n ** 62n - 1n;

// QUIC VarInt
function getVint53(buf: Uint8Array): [number, Uint8Array] {
	const size = 1 << ((buf[0] & 0xc0) >> 6);

	const view = new DataView(buf.buffer, buf.byteOffset, size);
	const remain = new Uint8Array(buf.buffer, buf.byteOffset + size, buf.byteLength - size);
	let v: number;

	if (size === 1) {
		v = buf[0] & 0x3f;
	} else if (size === 2) {
		v = view.getUint16(0) & 0x3fff;
	} else if (size === 4) {
		v = view.getUint32(0) & 0x3fffffff;
	} else if (size === 8) {
		// NOTE: Precision loss above 2^52
		v = Number(view.getBigUint64(0) & 0x3fffffffffffffffn);
	} else {
		throw new Error("impossible");
	}

	return [v, remain];
}

function setVint53(dst: Uint8Array, v: number): Uint8Array {
	if (v <= MAX_U6) {
		dst[0] = v;
		return new Uint8Array(dst.buffer, dst.byteOffset, 1);
	}

	if (v <= MAX_U14) {
		const view = new DataView(dst.buffer, dst.byteOffset, 2);
		view.setUint16(0, v | 0x4000);
		return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
	}

	if (v <= MAX_U30) {
		const view = new DataView(dst.buffer, dst.byteOffset, 4);
		view.setUint32(0, v | 0x80000000);
		return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
	}

	if (v <= MAX_U53) {
		const view = new DataView(dst.buffer, dst.byteOffset, 8);
		view.setBigUint64(0, BigInt(v) | 0xc000000000000000n);
		return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
	}

	throw new Error(`overflow, value larger than 53-bits: ${v}`);
}
