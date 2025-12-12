// Color conversion utilities

// Convert HSL to RGB
// h: hue in degrees (0-360)
// s: saturation (0-1)
// l: lightness (0-1)
vec3 hsl2rgb(float h, float s, float l) {
	float c = (1.0 - abs(2.0 * l - 1.0)) * s;
	float x = c * (1.0 - abs(mod(h / 60.0, 2.0) - 1.0));
	float m = l - c / 2.0;

	vec3 rgb;
	if (h < 60.0) rgb = vec3(c, x, 0.0);
	else if (h < 120.0) rgb = vec3(x, c, 0.0);
	else if (h < 180.0) rgb = vec3(0.0, c, x);
	else if (h < 240.0) rgb = vec3(0.0, x, c);
	else if (h < 300.0) rgb = vec3(x, 0.0, c);
	else rgb = vec3(c, 0.0, x);

	return rgb + m;
}
