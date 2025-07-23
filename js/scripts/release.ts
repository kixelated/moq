// ChatGPT made a script that rewrites package.json file to use the correct paths.
// The problem is that I want paths to reference `src` during development, but `dist` during release.
// It's not pretty but nothing in NPM is.

import { execSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

console.log("🧹 Cleaning dist/...");
rmSync("dist", { recursive: true, force: true });

console.log("🛠️  Building...");
execSync("pnpm i && pnpm build", { stdio: "inherit" });

console.log("✍️  Rewriting package.json...");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

function rewritePath(p: string): string {
	return p.replace(/^\.\/src/, ".").replace(/\.ts(x)?$/, ".js");
}

pkg.main &&= rewritePath(pkg.main);
pkg.types &&= rewritePath(pkg.types);

if (pkg.exports) {
	for (const key in pkg.exports) {
		const val = pkg.exports[key];
		if (typeof val === "string") {
			pkg.exports[key] = rewritePath(val);
		} else if (typeof val === "object") {
			for (const sub in val) {
				if (typeof val[sub] === "string") {
					val[sub] = rewritePath(val[sub]);
				}
			}
		}
	}
}

if (pkg.sideEffects) {
	pkg.sideEffects = pkg.sideEffects.map(rewritePath);
}

if (pkg.files) {
	pkg.files = pkg.files.map(rewritePath);
}

// Convert workspace dependencies to published versions
if (pkg.dependencies) {
	for (const [name, version] of Object.entries(pkg.dependencies)) {
		if (typeof version === 'string' && version.startsWith('workspace:')) {
			// Read the actual version from the workspace package
			// Handle both scoped (@scope/name) and unscoped (name) packages
			const packageDir = name.includes('/') ? name.split('/')[1] : name;
			const workspacePkgPath = `../${packageDir}/package.json`;
			try {
				const workspacePkg = JSON.parse(readFileSync(workspacePkgPath, 'utf8'));
				pkg.dependencies[name] = `^${workspacePkg.version}`;
				console.log(`🔗 Converted ${name}: ${version} → ^${workspacePkg.version}`);
			} catch (e) {
				console.warn(`⚠️  Could not resolve workspace dependency ${name}`);
			}
		}
	}
}

pkg.devDependencies = undefined;
pkg.scripts = undefined;

mkdirSync("dist", { recursive: true });
writeFileSync("dist/package.json", JSON.stringify(pkg, null, 2));

// Copy static files
console.log("📄 Copying README.md...");
copyFileSync("README.md", join("dist", "README.md"));

console.log("🔍 Installing dependencies...");
execSync("pnpm install", {
	stdio: "inherit",
	cwd: "dist",
});

console.log("🚀 Publishing...");
execSync("pnpm publish --access=public", {
	stdio: "inherit",
	cwd: "dist",
});
