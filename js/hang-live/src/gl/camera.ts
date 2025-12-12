import { Vector } from "../geometry";

export class Camera {
	projection: Float32Array;

	constructor() {
		this.projection = new Float32Array(16);
	}

	// Create a 2D orthographic projection matrix
	updateOrtho(viewport: Vector) {
		const left = 0;
		const right = viewport.x;
		const bottom = viewport.y;
		const top = 0;
		const near = -100; // Allow some depth for z-index
		const far = 100;

		// Column-major order for WebGL
		this.projection[0] = 2 / (right - left);
		this.projection[1] = 0;
		this.projection[2] = 0;
		this.projection[3] = 0;

		this.projection[4] = 0;
		this.projection[5] = 2 / (top - bottom);
		this.projection[6] = 0;
		this.projection[7] = 0;

		this.projection[8] = 0;
		this.projection[9] = 0;
		this.projection[10] = 2 / (near - far);
		this.projection[11] = 0;

		this.projection[12] = (left + right) / (left - right);
		this.projection[13] = (bottom + top) / (bottom - top);
		this.projection[14] = (near + far) / (near - far);
		this.projection[15] = 1;
	}

	// Convert z-index to depth value
	// Higher z-index = closer to camera (lower depth value for LEQUAL test)
	zToDepth(z: number, maxZ: number): number {
		// Normalize z-index to 0-1 range, then map to depth range
		// We use a small range to keep everything mostly 2D
		// Invert so higher z = more negative (closer to camera)
		const normalized = maxZ > 0 ? z / maxZ : 0;
		return -(1.0 - normalized) * 0.01; // Higher z = closer to 0 (front)
	}
}
