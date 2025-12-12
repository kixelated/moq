// Shared deformation constants and functions for vertex shaders
// Used across border, broadcast, and audio renderers

// Deformation strength constants
const float ZOOM_FALLOFF_DISTANCE = 0.7;
const float ZOOM_DEFORM_STRENGTH = 0.3;
const float DRAG_FALLOFF_DISTANCE = 0.5; // Radius of influence for drag effect

// Apply mesh deformation based on drag and zoom
// vertexPos: vertex position in normalized coordinates (0-1)
// u_dragPoint: normalized drag point (0-1) relative to broadcast
// u_velocity: current velocity vector in pixels
// u_dragStrength: strength multiplier for drag effect
// u_zoomDeform: zoom deformation (positive = expanding, negative = contracting)
// u_zoomCenter: normalized zoom center (0-1) relative to broadcast
// u_bounds: bounds in pixel space (x, y, width, height)
// Returns: deformed position in pixel space
vec2 applyDeformation(
	vec2 vertexPos,
	vec2 u_dragPoint,
	vec2 u_velocity,
	float u_dragStrength,
	float u_zoomDeform,
	vec2 u_zoomCenter,
	vec4 u_bounds
) {
	// Calculate zoom deformation (radial expansion/contraction from zoom center)
	if (abs(u_zoomDeform) > 0.001) {
		// Distance from zoom center
		vec2 fromCenter = vertexPos - u_zoomCenter;
		float distFromCenter = length(fromCenter);

		// Stronger effect in the middle, weaker at edges
		// Use a smooth curve: effect decreases as we move away from center
		// At center (dist=0): full effect
		// At corners (dist~0.7): minimal effect
		float zoomFalloff = 1.0 - smoothstep(0.0, ZOOM_FALLOFF_DISTANCE, distFromCenter);

		// Apply radial deformation in normalized space
		// This pushes vertices away from/toward center based on zoom direction
		vertexPos += fromCenter * u_zoomDeform * zoomFalloff * ZOOM_DEFORM_STRENGTH;
	}

	// Now apply drag deformation in normalized space (like zoom)
	vec2 deformation = vec2(0.0);

	if (length(u_velocity) > 0.0) {
		// Distance from this vertex to the drag point in normalized space
		float dist = distance(vertexPos, u_dragPoint);

		// Falloff: stronger near drag point, weaker far away
		// Using smoothstep for radius-based influence (similar to zoom)
		float falloff = 1.0 - smoothstep(0.0, DRAG_FALLOFF_DISTANCE, dist);

		// Normalize velocity to get direction
		vec2 velocityDir = normalize(u_velocity);

		// Apply directional displacement with falloff in normalized space
		// Scale by bounds aspect ratio to keep deformation uniform
		vec2 normalizedVelocity = velocityDir * length(u_velocity) / max(u_bounds.z, u_bounds.w);
		deformation = normalizedVelocity * falloff * u_dragStrength;
	}

	// Apply deformation in normalized space, then scale and translate to pixel space
	return (vertexPos + deformation) * u_bounds.zw + u_bounds.xy;
}
