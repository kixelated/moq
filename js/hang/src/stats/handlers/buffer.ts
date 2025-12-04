import type { HandlerContext, SyncStatus, BufferStatus } from "../types";
import { BaseHandler } from "./base";

/**
 * Handler for buffer metrics (fill percentage, latency)
 */
export class BufferHandler extends BaseHandler {
	/** Display context for updating metrics */
	private context: HandlerContext | undefined;
	/** Bound callback for display updates */
	private updateDisplay = () => this.updateDisplayData();

	/**
	 * Initialize buffer handler with signal subscriptions
	 */
	setup(context: HandlerContext): void {
		this.context = context;
		const video = this.props.video;

		if (!video) {
			context.setDisplayData("N/A");
			return;
		}

		this.subscribe(video.syncStatus, this.updateDisplay);
		this.subscribe(video.bufferStatus, this.updateDisplay);
		this.subscribe(video.latency, this.updateDisplay);

		this.updateDisplayData();
	}

	/**
	 * Calculate and display current buffer metrics
	 */
	private updateDisplayData(): void {
		if (!this.context || !this.props.video) {
			return;
		}

		const syncStatus = this.peekSignal<SyncStatus>(this.props.video?.syncStatus);
		const bufferStatus = this.peekSignal<BufferStatus>(this.props.video?.bufferStatus);
		const latency = this.peekSignal<number>(this.props.video.latency);

		const isLatencyValid = latency !== null && latency !== undefined && latency > 0;
		const bufferPercentage =
			syncStatus?.state === "wait" && syncStatus?.bufferDuration !== undefined && isLatencyValid
				? Math.min(100, Math.round((syncStatus.bufferDuration / latency!) * 100))
				: bufferStatus?.state === "filled"
					? 100
					: 0;

		const parts = [
			`${bufferPercentage}%`,
			isLatencyValid ? `${latency}ms` : "N/A",
		];

		this.context.setDisplayData(parts.join("\n"));
	}
}
