export class Bounds {
	position: Vector;
	size: Vector;

	constructor(position: Vector, size: Vector) {
		this.position = position;
		this.size = size;
	}

	static create(position: Vector, size: Vector) {
		return new Bounds(position, size);
	}

	static dom(el: DOMRect) {
		return new Bounds(Vector.create(el.x, el.y), Vector.create(el.width, el.height));
	}

	middle() {
		return Vector.create(this.position.x + this.size.x / 2, this.position.y + this.size.y / 2);
	}

	area() {
		return this.size.x * this.size.y;
	}

	mult(v: number) {
		return new Bounds(this.position.mult(v), this.size.mult(v));
	}

	div(v: number) {
		return new Bounds(this.position.div(v), this.size.div(v));
	}

	intersects(b: Bounds) {
		// Compute the intersection rectangle.
		const left = Math.max(this.position.x, b.position.x);
		const right = Math.min(this.position.x + this.size.x, b.position.x + b.size.x);
		const top = Math.max(this.position.y, b.position.y);
		const bottom = Math.min(this.position.y + this.size.y, b.position.y + b.size.y);

		if (left >= right || top >= bottom) {
			return;
		}

		return new Bounds(Vector.create(left, top), Vector.create(right - left, bottom - top));
	}

	contains(p: Vector): boolean {
		return (
			p.x >= this.position.x &&
			p.x <= this.position.x + this.size.x &&
			p.y >= this.position.y &&
			p.y <= this.position.y + this.size.y
		);
	}

	clone() {
		return new Bounds(this.position.clone(), this.size.clone());
	}

	lerp(other: Bounds, t: number) {
		return new Bounds(this.position.lerp(other.position, t), this.size.lerp(other.size, t));
	}
}

export class Vector {
	x: number;
	y: number;

	constructor(x: number, y: number) {
		this.x = x;
		this.y = y;
	}

	static create(x: number, y: number) {
		return new Vector(x, y);
	}

	mult(scalar: number) {
		return new Vector(this.x * scalar, this.y * scalar);
	}

	normalize() {
		const length = this.length();
		return new Vector(this.x / length, this.y / length);
	}

	add(other: Vector) {
		return new Vector(this.x + other.x, this.y + other.y);
	}

	sub(other: Vector) {
		return new Vector(this.x - other.x, this.y - other.y);
	}

	div(scalar: number) {
		return new Vector(this.x / scalar, this.y / scalar);
	}

	length() {
		return Math.sqrt(this.x * this.x + this.y * this.y);
	}

	area() {
		return this.x * this.y;
	}

	clone() {
		return new Vector(this.x, this.y);
	}

	lerp(other: Vector, t: number) {
		return new Vector(this.x + (other.x - this.x) * t, this.y + (other.y - this.y) * t);
	}
}
