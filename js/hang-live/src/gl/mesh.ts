import { Canvas } from "../canvas";
import { Vector } from "../geometry";

// Constants for mesh sizing
export const BORDER_WIDTH = 12;
export const AUDIO_VIZ_WIDTH = 18; // BORDER_WIDTH * 1.5
export const DRAG_THRESHOLD = 0.5; // Minimum velocity magnitude to trigger mesh deformation
export const ZOOM_THRESHOLD = 0.1; // Minimum zoom deformation to trigger mesh subdivision (lower than drag)

export interface MeshConfig {
	meshSubdivisions: number; // Grid size (e.g., 20 for 20x20 grid)
}

export class MeshBuffer {
	#canvas: Canvas;
	#config: MeshConfig;
	#positionBuffer: WebGLBuffer;
	#texCoordBuffer: WebGLBuffer;
	#indexBuffer: WebGLBuffer;

	// Current mesh state
	#isSubdivided = false;
	#vertexCount = 0;
	#indexCount = 0;

	constructor(canvas: Canvas, config: MeshConfig = { meshSubdivisions: 20 }) {
		this.#canvas = canvas;
		this.#config = config;

		const gl = canvas.gl;

		const positionBuffer = gl.createBuffer();
		if (!positionBuffer) throw new Error("Failed to create position buffer");
		this.#positionBuffer = positionBuffer;

		const texCoordBuffer = gl.createBuffer();
		if (!texCoordBuffer) throw new Error("Failed to create texCoord buffer");
		this.#texCoordBuffer = texCoordBuffer;

		const indexBuffer = gl.createBuffer();
		if (!indexBuffer) throw new Error("Failed to create index buffer");
		this.#indexBuffer = indexBuffer;

		// Start with a simple quad
		this.#generateQuad();
	}

	get positionBuffer(): WebGLBuffer {
		return this.#positionBuffer;
	}

	get texCoordBuffer(): WebGLBuffer {
		return this.#texCoordBuffer;
	}

	get indexBuffer(): WebGLBuffer {
		return this.#indexBuffer;
	}

	get indexCount(): number {
		return this.#indexCount;
	}

	get vertexCount(): number {
		return this.#vertexCount;
	}

	// Update mesh based on velocity and zoom deformation
	update(velocity: Vector, zoomDeform: number) {
		const velocityMagnitude = velocity.length();
		const zoomMagnitude = Math.abs(zoomDeform);
		const shouldSubdivide = velocityMagnitude > DRAG_THRESHOLD || zoomMagnitude > ZOOM_THRESHOLD;

		if (shouldSubdivide && !this.#isSubdivided) {
			this.#generateSubdividedMesh();
		} else if (!shouldSubdivide && this.#isSubdivided) {
			this.#generateQuad();
		}
	}

	#generateQuad() {
		const gl = this.#canvas.gl;

		// Simple quad (0-1 range)
		const positions = new Float32Array([
			0,
			0, // Top-left
			1,
			0, // Top-right
			1,
			1, // Bottom-right
			0,
			1, // Bottom-left
		]);

		const texCoords = new Float32Array([
			0,
			0, // Top-left
			1,
			0, // Top-right
			1,
			1, // Bottom-right
			0,
			1, // Bottom-left
		]);

		const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

		gl.bindBuffer(gl.ARRAY_BUFFER, this.#positionBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

		gl.bindBuffer(gl.ARRAY_BUFFER, this.#texCoordBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#indexBuffer);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

		this.#isSubdivided = false;
		this.#vertexCount = 4;
		this.#indexCount = 6;
	}

	#generateSubdividedMesh() {
		const gl = this.#canvas.gl;
		const subdivisions = this.#config.meshSubdivisions;
		const verticesPerRow = subdivisions + 1;
		const totalVertices = verticesPerRow * verticesPerRow;

		const positions = new Float32Array(totalVertices * 2);
		const texCoords = new Float32Array(totalVertices * 2);

		// Generate vertex grid
		let index = 0;
		for (let y = 0; y <= subdivisions; y++) {
			for (let x = 0; x <= subdivisions; x++) {
				const u = x / subdivisions;
				const v = y / subdivisions;

				// Position (0-1 range)
				positions[index * 2] = u;
				positions[index * 2 + 1] = v;

				// Texture coordinates
				texCoords[index * 2] = u;
				texCoords[index * 2 + 1] = v;

				index++;
			}
		}

		// Generate indices for triangles
		const indicesPerQuad = 6;
		const totalQuads = subdivisions * subdivisions;
		const indices = new Uint16Array(totalQuads * indicesPerQuad);

		let indicesIndex = 0;
		for (let y = 0; y < subdivisions; y++) {
			for (let x = 0; x < subdivisions; x++) {
				const topLeft = y * verticesPerRow + x;
				const topRight = topLeft + 1;
				const bottomLeft = topLeft + verticesPerRow;
				const bottomRight = bottomLeft + 1;

				// First triangle
				indices[indicesIndex++] = topLeft;
				indices[indicesIndex++] = topRight;
				indices[indicesIndex++] = bottomRight;

				// Second triangle
				indices[indicesIndex++] = topLeft;
				indices[indicesIndex++] = bottomRight;
				indices[indicesIndex++] = bottomLeft;
			}
		}

		gl.bindBuffer(gl.ARRAY_BUFFER, this.#positionBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

		gl.bindBuffer(gl.ARRAY_BUFFER, this.#texCoordBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.#indexBuffer);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

		this.#isSubdivided = true;
		this.#vertexCount = totalVertices;
		this.#indexCount = indices.length;
	}

	close() {
		const gl = this.#canvas.gl;
		gl.deleteBuffer(this.#positionBuffer);
		gl.deleteBuffer(this.#texCoordBuffer);
		gl.deleteBuffer(this.#indexBuffer);
	}
}
