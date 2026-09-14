import type { QueryStep } from "./types.ts";

export function visualizationDocument(
  html: string,
  steps: QueryStep[],
): string {
  // Escape data before placing it in a script so database strings cannot end the tag.
  const data = JSON.stringify(steps)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `<!doctype html><html><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{margin:0;padding:16px;font:14px system-ui,sans-serif;color:#263522}*{box-sizing:border-box}</style>
<script>window.queryResults = ${data};</script>
</head><body>${html}</body></html>`;
}
