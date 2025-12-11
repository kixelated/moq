import type { HandlerContext } from "../types";
import { BaseHandler } from "./base";

/**
 * Handler for buffer metrics (fill percentage, latency)
 */
export class BufferHandler extends BaseHandler {
	/** Display context for updating metrics */
	private context: HandlerContext | undefined;

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

		// Subscribe to signal changes using Effect
		this.signals.effect((effect) => {
			const { source } = video;

			if (source.syncStatus?.subscribe) {
				effect.cleanup(source.syncStatus.subscribe(() => this.updateDisplayData()));
			}

			if (source.bufferStatus?.subscribe) {
				effect.cleanup(source.bufferStatus.subscribe(() => this.updateDisplayData()));
			}

			if (source.latency?.subscribe) {
				effect.cleanup(source.latency.subscribe(() => this.updateDisplayData()));
			}
		});

		this.updateDisplayData();
	}

	/**
	 * Calculate and display current buffer metrics
	 */
	private updateDisplayData(): void {
		if (!this.context || !this.props.video) {
			return;
		}

		const syncStatus = this.props.video.source.syncStatus.peek();
		const bufferStatus = this.props.video.source.bufferStatus.peek();
		const latency = this.props.video.source.latency.peek();

		const isLatencyValid = latency !== null && latency !== undefined && latency > 0;
		const bufferPercentage =
			syncStatus?.state === "wait" && syncStatus?.bufferDuration !== undefined && isLatencyValid
				? Math.min(100, Math.round((syncStatus.bufferDuration / latency) * 100))
				: bufferStatus?.state === "filled"
					? 100
					: 0;

		const parts = [`${bufferPercentage}%`, isLatencyValid ? `${latency}ms` : "N/A"];

		this.context.setDisplayData(parts.join("\n"));
	}
}
