export function checkOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return;
  const requestUrl = new URL(request.url);
  // Next.js can expose its internal localhost URL even for a LAN request.
  // Compare against the actual HTTP Host; do not trust forwarded host headers.
  const host = request.headers.get("host") || requestUrl.host;
  const expected = new URL(`${requestUrl.protocol}//${host}`).origin;
  if (origin !== expected) {
    throw new Error("Invalid request origin.");
  }
}
