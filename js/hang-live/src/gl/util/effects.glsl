// Visual effects utilities

// Chroma key removal for greenscreen
// color: the pixel color to test
// Returns alpha: 0.0 for pixels matching key color, 1.0 for other pixels
float chromaKey(vec3 color) {
	// Hard-coded chroma key color: 0x00FF00 (pure green)
	vec3 keyColor = vec3(0.0, 1.0, 0.0);

	// Convert RGB to YUV (BT.601) - same as ffmpeg chromakey filter
	// Y = luminance, U and V = chrominance
	float colorU = -0.147 * color.r - 0.289 * color.g + 0.436 * color.b;
	float colorV = 0.615 * color.r - 0.515 * color.g - 0.100 * color.b;

	// Pre-computed YUV values for 0x00FF00
	// keyY = 0.587, keyU = -0.289, keyV = -0.515
	float keyU = -0.289;
	float keyV = -0.515;

	// Calculate distance in UV (chrominance) space only, ignore Y (luminance)
	float chromaDist = distance(vec2(colorU, colorV), vec2(keyU, keyV));

	// Tuned similarity threshold for good edge quality
	float similarity = 0.5;
	float blend = 0.05;

	return smoothstep(similarity - blend, similarity + blend, chromaDist);
}
