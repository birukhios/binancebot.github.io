import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const configPath = resolve(".vercel/output/config.json");
const outputRoot = resolve(".vercel/output");

if (!existsSync(configPath)) {
  process.exit(0);
}

const config = JSON.parse(readFileSync(configPath, "utf8"));
if (!Array.isArray(config.routes)) {
  process.exit(0);
}

const routes = config.routes;
const catchAllIndex = routes.findIndex((route) => route.src === "/(?:.*)" && route.dest === "/[...]");
const serverIndex = routes.findIndex((route) => route.src === "/(.*)" && route.dest === "/__server");

if (catchAllIndex === -1 || serverIndex === -1 || serverIndex < catchAllIndex) {
  process.exit(0);
}

const [catchAll] = routes.splice(catchAllIndex, 1);
const nextServerIndex = routes.findIndex((route) => route.src === "/(.*)" && route.dest === "/__server");
routes.splice(nextServerIndex + 1, 0, catchAll);

writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
console.log("Adjusted Vercel route order so SSR handles app pages before the static fallback.");

const assetsDir = resolve(outputRoot, "static/assets");
const cssAsset = readdirSync(assetsDir).find((file) => /^styles-.*\.css$/.test(file));
const functionsDir = resolve(outputRoot, "functions/[...].func");
const manifestFile = readdirSync(functionsDir).find((file) =>
  /^_tanstack-start-manifest_v-.*\.mjs$/.test(file),
);
const manifestPath = manifestFile ? resolve(functionsDir, manifestFile) : "";

if (!cssAsset || !existsSync(manifestPath)) {
  process.exit(0);
}

const manifestSource = readFileSync(manifestPath, "utf8");
const scriptMatch = manifestSource.match(/src:\s*"([^"]+index-[^"]+\.js)"/);
if (!scriptMatch) {
  process.exit(0);
}

const scriptSrc = scriptMatch[1];
const cssHref = `/assets/${cssAsset}`;
const injection = `\n    <link rel="stylesheet" href="${cssHref}" />\n    <script type="module" src="${scriptSrc}"></script>`;

for (const templatePath of [
  resolve(outputRoot, "functions/[...].func/_chunks/renderer-template.mjs"),
  resolve(outputRoot, "functions/__server.func/_chunks/renderer-template.mjs"),
]) {
  if (!existsSync(templatePath)) continue;
  const source = readFileSync(templatePath, "utf8");
  if (source.includes(scriptSrc)) continue;
  const patched = source.replace("</head>\\n  <body>", `${injection}\\n  </head>\\n  <body>`);
  writeFileSync(templatePath, patched);
}

console.log(`Injected Vercel client assets into renderer template: ${scriptSrc} and ${cssHref}.`);
