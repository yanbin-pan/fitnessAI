import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const r = await esbuild.build({
  entryPoints: [path.join(here, "src/main.tsx")], bundle: true, minify: true, format: "iife", write: false,
  jsx: "automatic", target: "es2020", define: { "process.env.NODE_ENV": '"production"' },
  alias: { "@app": path.join(here, "../../web/src") }, nodePaths: [path.join(here, "node_modules")], legalComments: "none",
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = fs.readFileSync(path.join(here, "src/page.css"), "utf8");
const html = `<title>Zabaione Waitlist</title>
<meta name="description" content="Zabaione: the AI food and fitness coach that remembers. Join the waitlist.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT@9..144,500..600,100&family=Inter:wght@400;500;600&display=swap">
<style>${css}</style>
<div id="root"></div>
<script>${js}</script>
`;
fs.writeFileSync(path.join(here, "zabaione-landing.html"), html);
// dist/ is what Cloudflare Pages serves: the page, plus everything in public/.
const dist = path.join(here, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(here, "public"), dist, { recursive: true });
fs.writeFileSync(path.join(dist, "index.html"), `<!doctype html>\n<html lang="en">\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n${html}</html>\n`);
console.log("bytes", html.length);
