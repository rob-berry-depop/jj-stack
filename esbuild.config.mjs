import { build } from "esbuild";

const config = {
  entryPoints: ["src/cli/index.ts"],
  bundle: true,
  platform: "node",
  target: "node18", // Match your current Node version, can upgrade to node20 later
  format: "esm",
  outfile: "dist/cli/index.js",
  sourcemap: true,

  // Handle TypeScript and JavaScript files (including .res.mjs from ReScript)
  resolveExtensions: [".ts", ".tsx", ".js", ".mjs", ".json"],

  // Keep Node.js built-ins and problematic packages external
  external: [
    // Node.js built-ins
    "child_process",
    "util",
    "fs",
    "path",
    "os",
    "assert",
    "assert/strict",
    // Keep these packages external (they'll be installed as dependencies)
    "ink",
    "react",
    "octokit",
    "valibot",
    "which",
    // Bundle ReScript deps to fix the publishing issue
    // @rescript/core and @rescript/react will be bundled
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
