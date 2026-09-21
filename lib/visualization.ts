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
  return `<!doctype html><html lang="es"><head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{display:flow-root;margin:0;padding:16px;font:14px system-ui,sans-serif;color:#263522}*{box-sizing:border-box}</style>
<script>window.queryResults = ${data};</script>
</head><body>${html}<script>
(() => {
  let pending = false;
  let lastHeight = 0;
  function measure() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      const body = document.body;
      const height = Math.ceil(Math.max(body.getBoundingClientRect().height, body.scrollHeight));
      if (height > 0 && height !== lastHeight) {
        lastHeight = height;
        parent.postMessage({ type: "visualization-height", height }, "*");
      }
    });
  }
  new ResizeObserver(measure).observe(document.body);
  new MutationObserver(measure).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
  window.addEventListener("resize", measure);
  window.addEventListener("load", measure);
  document.addEventListener("load", measure, true);
  window.addEventListener("message", (event) => {
    if (event.source === parent && event.data?.type === "visualization-measure") {
      lastHeight = 0;
      measure();
    }
  });
  document.fonts.ready.then(measure);
  measure();
})();
</script></body></html>`;
}
