/**
 * Icon type for stats metrics
 */
export type Icons = "network" | "video" | "audio" | "buffer";

/**
 * Context passed to handlers for updating display data
 */
export interface HandlerContext {
	setDisplayData: (data: string) => void;
	setFps?: (fps: number | null) => void;
}

/**
 * Display resolution dimensions
 */
export interface DisplaySize {
	width: number;
	height: number;
}

/**
 * Stream sync status with buffer information
 */
export interface SyncStatus {
	state: "ready" | "wait";
	bufferDuration?: number;
}

/**
 * Stream buffer fill status
 */
export interface BufferStatus {
	state: "empty" | "filled";
}

/**
 * Generic reactive signal interface for accessing stream data
 */
export interface Signal<T> {
	peek(): T | undefined;
	subscribe?(callback: () => void): () => void;
}

/**
 * Audio stream source with reactive properties
 */
export interface AudioSource {
	active?: Signal<string>;
	config?: Signal<AudioConfig>;
	bitrate?: Signal<number>;
}

/**
 * Audio stream configuration properties
 */
export interface AudioConfig {
	sampleRate?: number;
	numberOfChannels?: number;
	bitrate?: number;
	codec?: string;
}

/**
 * Video stream source with reactive properties
 */
export interface VideoSource {
	display?: Signal<DisplaySize>;
	fps?: Signal<number>;
	syncStatus?: Signal<SyncStatus>;
	bufferStatus?: Signal<BufferStatus>;
	latency?: Signal<number>;
}

/**
 * Props passed to metric handlers containing stream sources
 */
export interface HandlerProps {
	audio?: AudioSource;
	video?: VideoSource;
}

/**
 * Interface for metric handler implementations
 */
export interface IStatsHandler {
	setup(context: HandlerContext): void;
	cleanup(): void;
}

/**
 * Constructor type for metric handler classes
 */
export type HandlerConstructor = new (props: HandlerProps) => IStatsHandler;

/**
 * HTML element containing active stream with signal pattern
 */
export interface StreamContainer extends HTMLElement {
	active?: { peek: () => { broadcast?: HandlerProps } | undefined } | { peek: () => HandlerProps | undefined };
}

/**
 * Container element with broadcast stream properties
 */
export interface BroadcastContainer {
	broadcast?: HandlerProps;
}