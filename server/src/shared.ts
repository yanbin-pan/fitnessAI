// The one import point for code shared with the web app. The server runs
// TypeScript with Node's type stripping, which does not apply inside
// node_modules, so shared code is imported by relative path, not as a package.
export * from "../../shared/src/index.ts";
