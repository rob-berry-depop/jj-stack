import { build } from "esbuild";

// Plugin to selectively bundle only ReScript dependencies
const selectiveBundlePlugin = {
  name: "selective-bundle",
  setup(build) {
    // Bundle ReScript packages (to fix publishing issue)
    const rescriptPattern = /^@rescript\//;

    // External everything else from node_modules
    const nodeModulesPattern = /^[^./]|^\.[^./]|^\.\.[^/]/; // matches node_modules imports

    build.onResolve({ filter: nodeModulesPattern }, (args) => {
      // Bundle ReScript packages
      if (rescriptPattern.test(args.path)) {
        return; // Let esbuild bundle it
      }

      // External everything else
      return { path: args.path, external: true };
    });
  },
};

const config = {
  entryPoints: ["src/cli/index.ts"],
  bundle: true,
  platform: "node",
  target: "node18", // Match your current Node version, can upgrade to node20 later
  format: "esm",
  outfile: "dist/cli/index.js",
  sourcemap: process.env.NODE_ENV === "development",

  // Handle TypeScript and JavaScript files (including .res.mjs from ReScript)
  resolveExtensions: [".ts", ".tsx", ".js", ".mjs", ".json"],

  // Use plugin for selective bundling
  plugins: [selectiveBundlePlugin],

  // Only keep Node.js built-ins external
  external: [
    "child_process",
    "util",
    "fs",
    "path",
    "os",
    "assert",
    "assert/strict",
  ],

  // JSX configuration for React/Ink components
  jsx: "automatic",
  jsxImportSource: "react",

  // Minify in production, readable in development
  minify: false,

  // Tree shaking
  treeShaking: true,
};

try {
  await build(config);
  console.log("✅ Build completed successfully");
} catch (error) {
  console.error("❌ Build failed:", error);
  process.exit(1);
}
