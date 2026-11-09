import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const r = await esbuild.build({
  entryPoints: [path.join(here, "src/game.tsx")], bundle: true, minify: true, format: "iife", write: false,
  jsx: "automatic", target: "es2020", define: { "process.env.NODE_ENV": '"production"' },
  alias: { "@app": path.join(here, "../../web/src") }, nodePaths: [path.join(here, "node_modules")], legalComments: "none",
});
const js = r.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
const css = fs.readFileSync(path.join(here, "src/page.css"), "utf8") + fs.readFileSync(path.join(here, "src/game.css"), "utf8");
const html = `<title>Guess and Grow</title>
<meta name="description" content="Guess which food has more protein or less salt, and grow your Zabaione companion.">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght,SOFT@9..144,500..600,100&family=Inter:wght@400;500;600;700&display=swap">
<style>${css}</style>
<div id="root"></div>
<script>${js}</script>
`;
fs.writeFileSync(path.join(here, "zabaione-game.html"), html);
console.log("bytes", html.length);
