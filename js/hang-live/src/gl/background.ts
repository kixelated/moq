import backgroundFragSource from "./background.frag";
import backgroundVertSource from "./background.vert";
import type { GLContext } from "./context";
import { Attribute, Shader, Uniform1f, Uniform2f } from "./shader";

export class BackgroundRenderer {
	#glContext: GLContext;
	#program: Shader;
	#vao: WebGLVertexArrayObject;
	#positionBuffer: WebGLBuffer;

	// Typed uniforms and attributes
	#u_resolution: Uniform2f;
	#u_time: Uniform1f;
	#a_position: Attribute;

	constructor(glContext: GLContext) {
		this.#glContext = glContext;
		const gl = glContext.gl;

		this.#program = new Shader(gl, backgroundVertSource, backgroundFragSource);

		// Initialize typed uniforms and attributes
		this.#u_resolution = this.#program.createUniform2f("u_resolution");
		this.#u_time = this.#program.createUniform1f("u_time");
		this.#a_position = this.#program.createAttribute("a_position");

		const vao = gl.createVertexArray();
		if (!vao) throw new Error("Failed to create VAO");
		this.#vao = vao;

		const positionBuffer = gl.createBuffer();
		if (!positionBuffer) throw new Error("Failed to create position buffer");
		this.#positionBuffer = positionBuffer;

		this.#setupQuad();
	}

	#setupQuad() {
		const gl = this.#glContext.gl;

		// Fullscreen quad vertices (clip space)
		const positions = new Float32Array([-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0]);

		gl.bindVertexArray(this.#vao);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.#positionBuffer);
		gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

		gl.enableVertexAttribArray(this.#a_position.location);
		gl.vertexAttribPointer(this.#a_position.location, 2, gl.FLOAT, false, 0, 0);

		gl.bindVertexArray(null);
	}

	render(now: DOMHighResTimeStamp) {
		const gl = this.#glContext.gl;
		const viewport = this.#glContext.viewport.peek();

		this.#program.use();
		this.#u_resolution.set(viewport.x, viewport.y);
		this.#u_time.set(now);

		gl.bindVertexArray(this.#vao);
		gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
		gl.bindVertexArray(null);
	}

	cleanup() {
		const gl = this.#glContext.gl;
		gl.deleteVertexArray(this.#vao);
		gl.deleteBuffer(this.#positionBuffer);
		this.#program.cleanup();
	}
}
