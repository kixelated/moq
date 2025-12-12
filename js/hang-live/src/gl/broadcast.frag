#version 300 es
precision highp float;

in vec2 v_texCoord;
in vec2 v_pos;

uniform sampler2D u_frameTexture;
uniform sampler2D u_avatarTexture;
uniform bool u_avatarActive;
uniform bool u_flip; // Whether to flip the frame texture horizontally
uniform float u_radius;
uniform vec2 u_size;
uniform float u_opacity;
uniform float u_frameOpacity; // Pre-computed frame opacity (0-1)

out vec4 fragColor;

#include "./util/sdf.glsl"
#include "./util/effects.glsl"

void main() {
	// Calculate position from center
	vec2 center = (v_pos - 0.5) * u_size;

	// Calculate SDF for rounded corners
	float dist = roundedBoxSDF(center, u_size * 0.5, u_radius);

	// Discard pixels outside the rounded rectangle
	if (dist > 0.0) {
		discard;
	}

	// Smooth edge antialiasing
	float alpha = 1.0 - smoothstep(-1.0, 0.0, dist);

	// Calculate texture coordinates (flip horizontally if needed for frame)
	vec2 frameTexCoord = u_flip ? vec2(1.0 - v_texCoord.x, v_texCoord.y) : v_texCoord;

	// Sample textures using pre-computed opacity values
	vec4 frameColor = u_frameOpacity > 0.0 ? texture(u_frameTexture, frameTexCoord) : vec4(0.0, 0.0, 0.0, 1.0);
	vec4 avatarColor = u_avatarActive && u_frameOpacity < 1.0 ? texture(u_avatarTexture, v_texCoord) : vec4(0.0, 0.0, 0.0, 1.0);
	vec4 baseColor = mix(avatarColor, frameColor, u_frameOpacity);

	fragColor = vec4(baseColor.rgb, baseColor.a * alpha * u_opacity);
}
