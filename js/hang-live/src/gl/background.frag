#version 300 es
precision highp float;

in vec2 v_pixel;
out vec4 fragColor;

uniform vec2 u_resolution;
uniform float u_time;

const float LINE_SPACING = 28.0;
const float LINE_WIDTH = 4.0;
const float WOBBLE_AMPLITUDE = 5.0;
const float WOBBLE_SPEED = 0.0004;

const float SEGMENT_WIDTH = 120.0; // Pixels per segment

#include "./util/color.glsl"

// Hash function for deterministic randomness
float hash(float n) {
	return fract(sin(n) * 43758.5453123);
}

void main() {
	// Work in simple horizontal line space - rotation happens in vertex shader
	vec2 pos = v_pixel;

	// Determine which horizontal segment we're in
	float segmentIndex = floor(pos.x / SEGMENT_WIDTH);

	// Determine which line this pixel belongs to
	float lineIndex = floor(pos.y / LINE_SPACING);

	// Get wobble offsets at segment boundaries
	float seedStart = segmentIndex * 31.0 + lineIndex * 17.0;
	float seedEnd = (segmentIndex + 1.0) * 31.0 + lineIndex * 17.0;

	float wobbleStart = hash(seedStart) * WOBBLE_AMPLITUDE * 2.0 - WOBBLE_AMPLITUDE;
	float wobbleEnd = hash(seedEnd) * WOBBLE_AMPLITUDE * 2.0 - WOBBLE_AMPLITUDE;

	// Add animated wobble
	wobbleStart += sin(u_time * WOBBLE_SPEED + lineIndex + segmentIndex) * WOBBLE_AMPLITUDE;
	wobbleEnd += sin(u_time * WOBBLE_SPEED + lineIndex + segmentIndex + 1.0) * WOBBLE_AMPLITUDE;

	// Interpolate wobble within segment
	float segmentT = mod(pos.x, SEGMENT_WIDTH) / SEGMENT_WIDTH;
	float wobble = mix(wobbleStart, wobbleEnd, segmentT);

	// Calculate the line position (centered in the bucket)
	float baseLineY = lineIndex * LINE_SPACING + LINE_SPACING * 0.5;
	float lineY = baseLineY + wobble;

	// Distance from this pixel to the line
	float dist = abs(pos.y - lineY);

	// Calculate line color
	float hue = mod(lineIndex * 25.0 + u_time * 0.01, 360.0);
	vec3 lineColor = hsl2rgb(hue, 0.75, 0.5);

	// Anti-aliased lines with feathering
	float lineAlpha = 1.0 - smoothstep(LINE_WIDTH * 0.25, LINE_WIDTH * 1.25, dist);
	lineAlpha *= 0.5;

	fragColor = vec4(lineColor * lineAlpha, lineAlpha);
}
