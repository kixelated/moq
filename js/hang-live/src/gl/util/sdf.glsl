// Signed Distance Functions (SDF) for shapes

// Signed distance function for rounded rectangle
// Returns the signed distance from a point to a rounded rectangle
// center: position relative to rectangle center
// size: half-size of the rectangle (from center to edge)
// radius: corner radius
float roundedBoxSDF(vec2 center, vec2 size, float radius) {
	vec2 q = abs(center) - size + radius;
	return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - radius;
}
