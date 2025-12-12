#version 300 es

in vec2 a_position;

out vec2 v_pixel;

uniform vec2 u_resolution;

void main() {
	// Rotate the entire quad in clip space
	float angle = -0.25;
	float cosA = cos(angle);
	float sinA = sin(angle);
	vec2 rotatedPos = vec2(
		a_position.x * cosA - a_position.y * sinA,
		a_position.x * sinA + a_position.y * cosA
	);

	// Scale rotated quad to ensure it covers the viewport
	// sqrt(2) ~= 1.42 ensures rotated square covers original square
	rotatedPos *= 1.5;

	// Convert to pixel coordinates for fragment shader (unrotated logical space)
	vec2 uv = a_position * 0.5 + 0.5;
	v_pixel = uv * u_resolution;

	// Place background far back in depth (z = 1.0 in clip space)
	gl_Position = vec4(rotatedPos, 1.0, 1.0);
}
