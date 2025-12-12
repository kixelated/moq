import type { Broadcast } from "../broadcast";
import { Canvas } from "../canvas";
import borderFragSource from "./border.frag";
import borderVertSource from "./border.vert";
import type { Camera } from "./camera";
import type { MeshBuffer } from "./mesh";
import { Attribute, Shader, Uniform1f, Uniform2f, Uniform4f, UniformMatrix4fv } from "./shader";

export class BorderRenderer {
	#canvas: Canvas;
	#program: Shader;
	#vaos = new Map<MeshBuffer, WebGLVertexArrayObject>();

	// Typed uniforms
	#u_projection: UniformMatrix4fv;
	#u_bounds: Uniform4f;
	#u_depth: Uniform1f;
	#u_radius: Uniform1f;
	#u_size: Uniform2f;
	#u_opacity: Uniform1f;
	#u_dragPoint: Uniform2f;
	#u_velocity: Uniform2f;
	#u_dragStrength: Uniform1f;
	#u_zoomDeform: Uniform1f;
	#u_zoomCenter: Uniform2f;

	// Typed attributes
	#a_position: Attribute;

	constructor(canvas: Canvas) {
		this.#canvas = canvas;
		this.#program = new Shader(canvas.gl, borderVertSource, borderFragSource);

		// Initialize typed uniforms
		this.#u_projection = this.#program.createUniformMatrix4fv("u_projection");
		this.#u_bounds = this.#program.createUniform4f("u_bounds");
		this.#u_depth = this.#program.createUniform1f("u_depth");
		this.#u_radius = this.#program.createUniform1f("u_radius");
		this.#u_size = this.#program.createUniform2f("u_size");
		this.#u_opacity = this.#program.createUniform1f("u_opacity");
		this.#u_dragPoint = this.#program.createUniform2f("u_dragPoint");
		this.#u_velocity = this.#program.createUniform2f("u_velocity");
		this.#u_dragStrength = this.#program.createUniform1f("u_dragStrength");
		this.#u_zoomDeform = this.#program.createUniform1f("u_zoomDeform");
		this.#u_zoomCenter = this.#program.createUniform2f("u_zoomCenter");

		// Initialize typed attributes
		this.#a_position = this.#program.createAttribute("a_position");
	}

	#getOrCreateVAO(mesh: MeshBuffer): WebGLVertexArrayObject {
		let vao = this.#vaos.get(mesh);
		if (vao) return vao;

		const gl = this.#canvas.gl;
		vao = gl.createVertexArray();
		if (!vao) throw new Error("Failed to create VAO");

		gl.bindVertexArray(vao);

		// Position attribute
		gl.bindBuffer(gl.ARRAY_BUFFER, mesh.positionBuffer);
		gl.enableVertexAttribArray(this.#a_position.location);
		gl.vertexAttribPointer(this.#a_position.location, 2, gl.FLOAT, false, 0, 0);

		// Index buffer
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.indexBuffer);

		gl.bindVertexArray(null);

		this.#vaos.set(mesh, vao);
		return vao;
	}

	render(broadcast: Broadcast, camera: Camera, maxZ: number) {
		const gl = this.#canvas.gl;
		const bounds = broadcast.bounds.peek();
		const scale = broadcast.zoom.peek();
		const dragPoint = broadcast.dragPoint.peek();
		const deformVelocity = broadcast.deformVelocity;
		const zoomCenter = broadcast.zoomCenter.peek();

		// Get or create VAO for this broadcast's mesh
		const vao = this.#getOrCreateVAO(broadcast.mesh);

		this.#program.use();

		// Set projection matrix
		this.#u_projection.set(camera.projection);

		// Border size (PADDING from old implementation)
		const border = 12 * scale;

		// Bounds need to include the border expansion
		this.#u_bounds.set(
			bounds.position.x - border,
			bounds.position.y - border,
			bounds.size.x + border * 2,
			bounds.size.y + border * 2,
		);

		// Set depth - borders should be behind everything
		const baseDepth = camera.zToDepth(broadcast.position.peek().z, maxZ);
		const depth = baseDepth - 0.04; // Further behind than audio viz
		this.#u_depth.set(depth);

		// Set radius for rounded corners
		this.#u_radius.set(border);

		// Set size for SDF calculation
		this.#u_size.set(bounds.size.x + border * 2, bounds.size.y + border * 2);

		// Set opacity
		this.#u_opacity.set(broadcast.opacity);

		// Set drag deformation uniforms (using deformVelocity which decays separately)
		this.#u_dragPoint.set(dragPoint.x, dragPoint.y);
		this.#u_velocity.set(deformVelocity.x, deformVelocity.y);
		this.#u_dragStrength.set(0.5); // Halved for subtler effect

		// Set zoom deformation uniforms
		this.#u_zoomDeform.set(broadcast.zoomDeform);
		this.#u_zoomCenter.set(zoomCenter.x, zoomCenter.y);

		// Draw
		gl.bindVertexArray(vao);
		gl.drawElements(gl.TRIANGLES, broadcast.mesh.indexCount, gl.UNSIGNED_SHORT, 0);
		gl.bindVertexArray(null);
	}

	close() {
		const gl = this.#canvas.gl;
		for (const vao of this.#vaos.values()) {
			gl.deleteVertexArray(vao);
		}
		this.#vaos.clear();
		this.#program.cleanup();
	}
}
