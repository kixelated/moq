#version 300 es
precision highp float;

in vec2 v_pos;

uniform float u_radius;
uniform vec2 u_size;
uniform float u_opacity;
uniform float u_volume; // Audio volume 0-1 (smoothed)
uniform float u_border; // Border size in pixels
uniform vec3 u_color; // RGB color for the volume indicator
uniform float u_time; // Time in seconds for animation
uniform float u_finalAlpha; // Pre-computed final alpha (0.3 + volume * 0.4)

out vec4 fragColor;

#include "./util/sdf.glsl"

void main() {
	if (u_opacity <= 0.01) {
		discard;
	}

	// v_pos is 0-1 in the quad
	// u_size is the total quad size (video + maxExpansion on each side)
	// u_border is the border width (black outline size)

	// Calculate position from center of the bounds
	vec2 center = (v_pos - 0.5) * u_size;

	// The render bounds are expanded by 1.5x border, but we need to find the actual video size
	// maxExpansion = border * 1.5, so video size = u_size - 2*maxExpansion = u_size - 3.0*border
	vec2 videoSize = u_size - vec2(u_border * 3.0);

	// Inner edge at video boundary
	float videoDist = roundedBoxSDF(center, videoSize * 0.5, u_radius);

	// Discard if 2px within video area, creating a border.
	if (videoDist <= 2.0) {
		discard;
	}

	// Calculate angle around the perimeter for ripple effect
	float angle = atan(center.y, center.x);

	// Ripple effect using triangle wave (linear/jagged)
	float rippleFreq = 8.0; // Number of ripples around the perimeter
	float rippleSpeed = 1.5; // Slower animation
	float rippleAmount = u_volume * u_border * 0.1; // Ripple intensity (10% of border - more subtle)

	// Create ripple offset using triangle wave (sawtooth converted to triangle)
	// This creates a linear back-and-forth motion instead of smooth sine
	float phase = angle * rippleFreq + u_time * rippleSpeed;
	float sawtooth = fract(phase / (2.0 * 3.14159265));
	float triangle = abs(sawtooth * 2.0 - 1.0) * 2.0 - 1.0;
	float ripple = triangle * rippleAmount;

	// Base expansion from volume (0 to border)
	float baseExpand = u_border * min(1.0, u_volume);

	// Apply ripple to the expansion (can go beyond border slightly)
	float totalExpand = baseExpand + ripple;

	// Distance to the edge of the colored region
	float colorDist = roundedBoxSDF(center, videoSize * 0.5 + totalExpand, u_radius);

	// Line configuration (as percentage of border)
	float lineInset = u_border * 0.42; // Push line inward to hide behind video frame edge
	float lineWidth = u_border * 0.25; // Solid line width
	float aaWidth = u_border * 0.17;   // Anti-aliasing width on each side
	float totalWidth = lineWidth + aaWidth;

	// Discard if well outside the line region
	if (colorDist > totalWidth || videoDist < -lineInset) {
		discard;
	}

	// In the colored region
	vec3 finalColor = u_color;

	// Create a sharp line with AA on edges, inset from video boundary
	float innerEdge = videoDist + lineInset; // Offset inward
	float outerEdge = abs(colorDist);

	// Fade in from the inset edge over aaWidth
	float innerAA = smoothstep(0.0, aaWidth, innerEdge);

	// Full opacity in the middle of the line
	float lineMask = step(outerEdge, lineWidth);

	// Fade out at the outer edge over aaWidth
	float outerAA = smoothstep(lineWidth + aaWidth, lineWidth, outerEdge);

	// Combine: AA at inner edge, full in middle, AA at outer edge
	float aa = innerAA * mix(outerAA, 1.0, lineMask);

	fragColor = vec4(finalColor, u_finalAlpha * aa * u_opacity);
}
