import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
	root: "src",
	plugins: [tailwindcss()],
	build: {
		target: "esnext",
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
});
