// Typed uniform wrappers
export class Uniform1f {
	#location: WebGLUniformLocation;
	#gl: WebGL2RenderingContext;

	constructor(location: WebGLUniformLocation, gl: WebGL2RenderingContext) {
		this.#location = location;
		this.#gl = gl;
	}

	set(value: number) {
		this.#gl.uniform1f(this.#location, value);
	}
}

export class Uniform2f {
	#location: WebGLUniformLocation;
	#gl: WebGL2RenderingContext;

	constructor(location: WebGLUniformLocation, gl: WebGL2RenderingContext) {
		this.#location = location;
		this.#gl = gl;
	}

	set(x: number, y: number) {
		this.#gl.uniform2f(this.#location, x, y);
	}
}

export class Uniform3f {
	#location: WebGLUniformLocation;
	#gl: WebGL2RenderingContext;

	constructor(location: WebGLUniformLocation, gl: WebGL2RenderingContext) {
		this.#location = location;
		this.#gl = gl;
	}

	set(x: number, y: number, z: number) {
		this.#gl.uniform3f(this.#location, x, y, z);
	}
}

export class Uniform4f {
	#location: WebGLUniformLocation;
	#gl: WebGL2RenderingContext;

	constructor(location: WebGLUniformLocation, gl: WebGL2RenderingContext) {
		this.#location = location;
		this.#gl = gl;
	}

	set(x: number, y: number, z: number, w: number) {
		this.#gl.uniform4f(this.#location, x, y, z, w);
	}
}

export class Uniform1i {
	#location: WebGLUniformLocation;
	#gl: WebGL2RenderingContext;

	constructor(location: WebGLUniformLocation, gl: WebGL2RenderingContext) {
		this.#location = location;
		this.#gl = gl;
	}

	set(value: number) {
		this.#gl.uniform1i(this.#location, value);
	}
}

export class UniformMatrix4fv {
	#location: WebGLUniformLocation;
	#gl: WebGL2RenderingContext;

	constructor(location: WebGLUniformLocation, gl: WebGL2RenderingContext) {
		this.#location = location;
		this.#gl = gl;
	}

	set(value: Float32Array) {
		this.#gl.uniformMatrix4fv(this.#location, false, value);
	}
}

// Typed attribute wrapper
export class Attribute {
	readonly location: number;

	constructor(location: number) {
		this.location = location;
	}
}

export class Shader {
	gl: WebGL2RenderingContext;
	program: WebGLProgram;

	constructor(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string) {
		this.gl = gl;

		const vertexShader = this.#compileShader(gl.VERTEX_SHADER, vertexSource);
		const fragmentShader = this.#compileShader(gl.FRAGMENT_SHADER, fragmentSource);

		const program = gl.createProgram();
		if (!program) {
			throw new Error("Failed to create shader program");
		}

		gl.attachShader(program, vertexShader);
		gl.attachShader(program, fragmentShader);
		gl.linkProgram(program);

		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			const info = gl.getProgramInfoLog(program);
			gl.deleteProgram(program);
			throw new Error(`Shader program link failed: ${info}`);
		}

		this.program = program;

		// Clean up shaders after linking
		gl.deleteShader(vertexShader);
		gl.deleteShader(fragmentShader);
	}

	#compileShader(type: number, source: string): WebGLShader {
		const gl = this.gl;
		const shader = gl.createShader(type);
		if (!shader) {
			throw new Error("Failed to create shader");
		}

		gl.shaderSource(shader, source);
		gl.compileShader(shader);

		if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
			const info = gl.getShaderInfoLog(shader);
			gl.deleteShader(shader);
			throw new Error(`Shader compilation failed: ${info}`);
		}

		return shader;
	}

	use() {
		this.gl.useProgram(this.program);
	}

	#getUniform(name: string): WebGLUniformLocation {
		const loc = this.gl.getUniformLocation(this.program, name);
		if (!loc) {
			throw new Error(`Uniform ${name} not found`);
		}
		return loc;
	}

	#getAttribute(name: string): number {
		const loc = this.gl.getAttribLocation(this.program, name);
		if (loc === -1) {
			throw new Error(`Attribute ${name} not found`);
		}
		return loc;
	}

	// Typed wrapper factory methods
	createUniform1f(name: string): Uniform1f {
		return new Uniform1f(this.#getUniform(name), this.gl);
	}

	createUniform2f(name: string): Uniform2f {
		return new Uniform2f(this.#getUniform(name), this.gl);
	}

	createUniform3f(name: string): Uniform3f {
		return new Uniform3f(this.#getUniform(name), this.gl);
	}

	createUniform4f(name: string): Uniform4f {
		return new Uniform4f(this.#getUniform(name), this.gl);
	}

	createUniform1i(name: string): Uniform1i {
		return new Uniform1i(this.#getUniform(name), this.gl);
	}

	createUniformMatrix4fv(name: string): UniformMatrix4fv {
		return new UniformMatrix4fv(this.#getUniform(name), this.gl);
	}

	createAttribute(name: string): Attribute {
		return new Attribute(this.#getAttribute(name));
	}

	cleanup() {
		this.gl.deleteProgram(this.program);
	}
}
