import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	root: "src",
	plugins: [tailwindcss()],
	build: {
		target: "esnext",
		sourcemap: process.env.NODE_ENV === "production" ? false : "inline",
		rollupOptions: {
			input: {
				watch: "index.html",
				publish: "publish.html",
				support: "support.html",
				meet: "meet.html",
			},
		},
	},
	server: {
		// TODO: properly support HMR
		hmr: false,
	},
	optimizeDeps: {
		// No idea why this needs to be done, but I don't want to figure it out.
		exclude: ["@libav.js/variant-opus-af"],
	},
});
