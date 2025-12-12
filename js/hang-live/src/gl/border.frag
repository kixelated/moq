#version 300 es
precision highp float;

in vec2 v_pos;

uniform float u_radius;
uniform vec2 u_size;
uniform float u_opacity;
uniform float u_border; // Border size in pixels

out vec4 fragColor;

#include "./util/sdf.glsl"

void main() {
	// v_pos is 0-1 in the quad
	// u_size is the total bounds size (video + border on each side)
	// u_border is the border width

	// Calculate position from center of the bounds
	vec2 center = (v_pos - 0.5) * u_size;

	// Outer edge of the entire thing (edge of black border)
	float outerDist = roundedBoxSDF(center, u_size * 0.5, u_radius);

	// Discard anything outside the outer bounds
	if (outerDist > 1.0) {
		discard;
	}

	// Fill the entire area with black (no transparency gaps)
	vec3 color = vec3(0.0);
	float alpha = 1.0;

	// Antialiasing only on the outer edge
	float aa = 1.0 - smoothstep(-1.0, 0.0, outerDist);

	fragColor = vec4(color, alpha * aa * u_opacity);
}
