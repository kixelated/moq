import { defineConfig } from "vite";
import glsl from "vite-plugin-glsl";

// https://vitejs.dev/config/
export default defineConfig(() => {
	return {
		build: {
			target: "esnext",
			sourcemap: process.env.NODE_ENV === "production" ? false : ("inline" as const),
			rollupOptions: {
				input: "index.html",
			},
		},
		optimizeDeps: {
			exclude: ["@libav.js/variant-opus-af"],
		},

		worker: {
			format: "es" as const,
		},

		plugins: [
			glsl({
				minify: process.env.NODE_ENV === "production",
			}),
		],
	};
});
