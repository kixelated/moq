#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_texCoord;

uniform mat4 u_projection;
uniform vec4 u_bounds; // x, y, width, height
uniform float u_depth;
uniform vec2 u_dragPoint; // Normalized drag point (0-1) relative to broadcast
uniform vec2 u_velocity; // Current velocity vector
uniform float u_dragStrength; // Strength multiplier for drag effect
uniform float u_zoomDeform; // Zoom deformation (positive = expanding, negative = contracting)
uniform vec2 u_zoomCenter; // Normalized zoom center (0-1) relative to broadcast

out vec2 v_texCoord;
out vec2 v_pos; // Position within the quad (0-1)

#include "./deformation.glsl"

void main() {
	// Apply deformation using shared function
	vec2 pos = applyDeformation(
		a_position,
		u_dragPoint,
		u_velocity,
		u_dragStrength,
		u_zoomDeform,
		u_zoomCenter,
		u_bounds
	);

	// Apply projection
	gl_Position = u_projection * vec4(pos, u_depth, 1.0);

	v_texCoord = a_texCoord;
	v_pos = a_position;
}
