import { type Publish, Watch } from "@moq/hang";
import { Effect, Signal } from "@moq/signals";
import { Audio } from "./audio";
import type { Canvas } from "./canvas";
import { Chat } from "./chat";
import { Debug } from "./debug";
import type { FakeBroadcast } from "./fake";
import { Bounds, Vector } from "./geometry";
import { MeshBuffer } from "./gl/mesh";
import { Name } from "./name";
import type { Sound } from "./sound";
import { Video } from "./video";

export type BroadcastSource = Watch.Broadcast | Publish.Broadcast | FakeBroadcast;

export type ChatMessage = {
	audio?: HTMLAudioElement;
	video?: HTMLVideoElement;
	element: Node;
	received: DOMHighResTimeStamp;
	expires: DOMHighResTimeStamp;
};

// Catalog.Position but all fields are required.
type Position = {
	x: number;
	y: number;
	z: number;
	s: number;
};

export interface BroadcastProps<T extends BroadcastSource = BroadcastSource> {
	source: T;
	canvas: Canvas;
	sound: Sound;
	scale: Signal<number>;
}

export class Broadcast<T extends BroadcastSource = BroadcastSource> {
	source: T;
	canvas: Canvas;

	audio: Audio;
	video: Video;
	chat: Chat;
	name: Name;
	debug: Debug;

	// The current chat message, if any.
	message = new Signal<HTMLElement | undefined>(undefined);

	bounds: Signal<Bounds>; // 0 to canvas
	velocity = Vector.create(0, 0); // in pixels per ?

	// Drag point in normalized coordinates (0-1) relative to the broadcast
	dragPoint = new Signal<Vector>(Vector.create(0.5, 0.5));

	// Deformation velocity for the drag effect (decays independently from physics velocity)
	deformVelocity = Vector.create(0, 0);

	// Zoom deformation for scaling effect (positive = expanding, negative = contracting)
	// Only applies during user-initiated zooming (mouse wheel or pinch)
	zoomDeform = 0;

	// Zoom center point in normalized coordinates (0-1) relative to the broadcast
	zoomCenter = new Signal<Vector>(Vector.create(0.5, 0.5));

	// Shared mesh buffer for all renderers
	mesh: MeshBuffer;

	// Replaced by position
	//targetPosition = Vector.create(0, 0); // -0.5 to 0.5, sent over the network
	//targetScale = 1.0; // 1 is 100%

	visible: Signal<boolean>;

	// The target position of the broadcast, while bounds contains the actual position.
	// This is separate from the source.location.current so we can temporarily use our own value.
	// After we learn the real position over the network, we'll replace it.
	position: Signal<Position>;

	scale: Signal<number>; // room scale, 1 is 100%
	zoom = new Signal<number>(1.0); // local zoom, 1 is 100%

	online = new Signal<boolean>(true); // false is offline, true is online
	#onlineTransition: DOMHighResTimeStamp = 0;

	// Computed opacity based on online fade-in/fade-out (0-1)
	opacity: number = 1;

	signals = new Effect();

	constructor(props: BroadcastProps<T>) {
		this.source = props.source;
		this.canvas = props.canvas;
		this.visible = new Signal(true); // TODO
		this.scale = props.scale;

		// Create shared mesh buffer
		this.mesh = new MeshBuffer(props.canvas);

		// Unless provided, start them at the center of the screen with a tiiiiny bit of variance to break ties.
		const start = () => (Math.random() - 0.5) / 100;
		const position = {
			x: start(),
			y: start(),
			z: 0,
			s: 1,
		};

		this.position = new Signal(position);

		this.video = new Video(this);
		this.audio = new Audio(this, props.sound);
		this.chat = new Chat(this, props.canvas);
		this.name = new Name(this, props.canvas);
		this.debug = new Debug(this, props.canvas);

		const viewport = this.canvas.viewport.peek();

		let startPosition = Vector.create(position.x, position.y);
		if (position.x === 0 && position.y === 0) {
			// If we're in the center, avoid dividing by zero.
			startPosition = Vector.create(Math.random() - 0.5, Math.random() - 0.5);
		}

		// Normalize to find the closest edge of the screen.
		startPosition = startPosition.normalize().mult(viewport.length()).add(viewport.div(2));

		this.bounds = new Signal(new Bounds(startPosition, this.video.targetSize.peek()));

		this.signals.effect(this.#runLocation.bind(this));
		this.signals.effect(this.#runChat.bind(this));
		this.signals.effect(this.#runTarget.bind(this));
	}

	// Load the broadcaster's position from the network.
	#runLocation(effect: Effect) {
		if (!effect.get(this.visible)) {
			// Change the target position to somewhere outside the screen.
			this.position.update((prev) => {
				const offscreen = Vector.create(prev.x, prev.y).normalize().mult(2);
				return { ...prev, x: offscreen.x, y: offscreen.y };
			});

			return;
		}

		// Update the target position from the network.
		const location = effect.get(this.source.location.window.position);
		if (!location) return;

		this.position.update((prev) => {
			return {
				...prev,
				x: location.x ?? prev.x,
				y: location.y ?? prev.y,
				z: location.z ?? prev.z,
				s: location.s ?? prev.s,
			};
		});
	}

	#runChat(effect: Effect) {
		const enabled = effect.get(this.source.chat.message.enabled);
		if (!enabled) return;

		const msg = effect.get(this.source.chat.message.latest);
		if (!msg) return;

		effect.spawn(async () => {
			// Parse the markdown into sanitized HTML using a background WebWorker.
			const parsed = await this.chat.parse(msg);
			if (!parsed) return;

			effect.set(this.message, parsed);
		});
	}

	// Decides the simulcast size to use based on the number of pixels.
	#runTarget(effect: Effect) {
		if (!(this.source instanceof Watch.Broadcast)) return;

		const display = effect.get(this.source.video.display);
		if (!display) return;

		const pixels = display.height * display.width;
		const scale = effect.get(this.scale);
		const zoom = effect.get(this.zoom);

		const scaled = pixels * scale * zoom;
		effect.set(this.source.video.target, { pixels: scaled });
	}

	tick(now: DOMHighResTimeStamp) {
		this.audio.tick();
		this.video.tick(now);

		// Update mesh based on deformation velocity and zoom deformation
		this.mesh.update(this.deformVelocity, this.zoomDeform);

		// Decay deformation effects smoothly over time
		const DEFORM_DECAY = 0.95; // Higher = slower decay (lasts longer)
		const ZOOM_DECAY = 0.8; // Zoom decays faster

		// Decay drag deformation velocity
		this.deformVelocity = this.deformVelocity.mult(DEFORM_DECAY);

		// Decay zoom deformation
		this.zoomDeform *= ZOOM_DECAY;

		// Update opacity based on online status
		const fadeTime = 300; // ms
		const elapsed = now - this.#onlineTransition;
		this.opacity = this.online.peek() ? Math.min(1, elapsed / fadeTime) : Math.max(0, 1 - elapsed / fadeTime);

		const bounds = this.bounds.peek();
		const viewport = this.canvas.viewport.peek();

		const targetPosition = this.position.peek();

		// Guide the body towards the target position with a bit of force.
		const target = Vector.create((targetPosition.x + 0.5) * viewport.x, (targetPosition.y + 0.5) * viewport.y);

		// Make sure the target position is within the viewport.
		target.x = Math.max(0, Math.min(target.x, viewport.x));
		target.y = Math.max(0, Math.min(target.y, viewport.y));

		const middle = bounds.middle();
		const force = target.sub(middle);
		this.velocity = this.velocity.add(force);

		const PADDING = 32;

		const top = PADDING - bounds.position.y;
		const down = bounds.position.y + bounds.size.y - viewport.y + PADDING;
		const left = PADDING - bounds.position.x;
		const right = bounds.position.x + bounds.size.x - viewport.x + PADDING;

		if (top > 0) {
			if (down > 0) {
				// Do nothing, this element is huge.
			} else {
				this.velocity.y += top;
			}
		} else if (down > 0) {
			this.velocity.y -= down;
		}

		if (left > 0) {
			if (right > 0) {
				// Do nothing, this element is huge.
			} else {
				this.velocity.x += left;
			}
		} else if (right > 0) {
			this.velocity.x -= right;
		}

		// Apply everything now.
		const targetSize = this.video.targetSize.peek().mult(this.zoom.peek() * this.scale.peek());

		const dz = (targetPosition.s - this.zoom.peek()) * 0.1;
		if (Math.abs(dz) >= 0.002) {
			this.zoom.update((prev) => prev + dz);
		}

		// Apply the velocity and size.
		const dx = this.velocity.x / 50;
		const dy = this.velocity.y / 50;
		const dw = (targetSize.x - bounds.size.x) / 10;
		const dh = (targetSize.y - bounds.size.y) / 10;

		// Only update the bounds if there's a significant change, to avoid recalculating minutiae.
		if (Math.abs(dx) >= 0.05 || Math.abs(dy) >= 0.05 || Math.abs(dw) >= 0.05 || Math.abs(dh) >= 0.05) {
			this.bounds.mutate((bounds) => {
				bounds.size.x += dw;
				bounds.size.y += dh;
				bounds.position.x += dx;
				bounds.position.y += dy;
			});
		}

		// Pan the audio left or right based on the position.
		// If a broadcast is visible, then it will be between -0.5 and 0.5.
		const pan = bounds.middle().x / viewport.x - 0.5;
		this.audio.pan.set(Math.min(Math.max(pan, -1), 1));

		// Slow down the velocity for the next frame.
		this.velocity = this.velocity.mult(0.5);

		// Decay the deformation velocity smoothly over time (faster decay than physics velocity)
		if (this.deformVelocity.length() > 0.01) {
			this.deformVelocity = this.deformVelocity.mult(0.85);
		} else {
			this.deformVelocity = Vector.create(0, 0);
		}

		// Decay zoom deformation (set by user interaction in Space)
		// Slower decay than drag to keep mesh subdivided during zoom animation
		if (Math.abs(this.zoomDeform) > 0.01) {
			this.zoomDeform *= 0.95;
		} else {
			this.zoomDeform = 0;
		}
	}

	// Returns true if the broadcaster is locked to a position.
	locked(): boolean {
		if (this.source instanceof Watch.Broadcast) {
			return !this.source.location.window.handle.peek();
		}

		return false;
	}

	// Called when online status changes to trigger fade transition
	setOnline(online: boolean) {
		this.online.set(online);
		this.#onlineTransition = performance.now();
	}

	close() {
		this.signals.close();
		this.audio.close();
		this.video.close();
		this.chat.close();
		this.name.close();
		this.debug.close();
		this.mesh.close();

		// NOTE: Don't close the source broadcast; we need it for the local preview.
		// this.source.close();
	}
}
