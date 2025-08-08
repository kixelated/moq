import { AutoModel, AutoProcessor, type PreTrainedModel, type Processor, RawImage } from "@huggingface/transformers";
import * as Comlink from "comlink";
import type * as Catalog from "../../catalog";

export class DetectionWorker {
	#model: Promise<PreTrainedModel>;
	#processor: Promise<Processor>;
	#buffer = new ArrayBuffer(0);

	constructor() {
		// Load model and processor asynchronously
		const modelId = "Xenova/gelan-c_all";

		this.#model = AutoModel.from_pretrained(modelId);
		this.#processor = AutoProcessor.from_pretrained(modelId);
		this.#processor.then((processor) => {
			// @ts-expect-error Not well typed.
			processor.feature_extractor.size = { shortest_edge: 128 };
		});
	}

	async ready(): Promise<boolean> {
		await Promise.all([this.#model, this.#processor]);
		return true;
	}

	async detect(frame: VideoFrame, threshold = 0.5): Promise<Catalog.DetectionObjects> {
		try {
			return await this.#detect(frame, threshold);
		} finally {
			frame.close();
		}
	}

	async #detect(frame: VideoFrame, threshold: number): Promise<Catalog.DetectionObjects> {
		const copyTo: VideoFrameCopyToOptions = {
			format: "RGBA",
			colorSpace: "srgb",
		};

		const size = frame.allocationSize(copyTo);
		if (size > this.#buffer.byteLength) {
			this.#buffer = new ArrayBuffer(size);
		}

		const buffer = new Uint8Array(this.#buffer, 0, size);
		this.#buffer = new ArrayBuffer(0); // We're borrowing the buffer.
		frame.copyTo(buffer, copyTo);

		const image = new RawImage(buffer, frame.displayWidth, frame.displayHeight, 4);

		// Process image through model
		const processor = await this.#processor;
		const model = await this.#model;

		const inputs = await processor(image);
		const { outputs } = await model(inputs);

		const [height, width] = inputs.reshaped_input_sizes[0];
		const detections: Catalog.DetectionObjects = [];

		for (const [xmin, ymin, xmax, ymax, score, id] of outputs.tolist()) {
			if (score < threshold) continue;

			// @ts-expect-error Not properly typed.
			const label = model.config.id2label[id];
			detections.push({
				label,
				score,
				x: xmin / width,
				y: ymin / height,
				w: (xmax - xmin) / width,
				h: (ymax - ymin) / height,
			});
		}

		if (this.#buffer.byteLength > 0) {
			// Some other async operation allocated a new buffer.
			console.warn("Additional buffer allocated.");
		} else {
			// Return the buffer to the pool.
			this.#buffer = buffer.buffer;
		}

		return detections;
	}
}

// Expose the worker API via Comlink
Comlink.expose(new DetectionWorker());
