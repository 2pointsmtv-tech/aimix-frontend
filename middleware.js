// Vercel Edge Middleware (no framework, no dependencies).
// extendthemix.com/ must serve extendo.html, but Vercel serves a real file at "/" (the mixer's index.html)
// before vercel.json rewrites are considered, so the host switch has to happen here, ahead of the filesystem.
// Only "/" is matched; every other path and every other host passes straight through.
export const config = { matcher: ['/'] };

export default function middleware(request) {
  try {
    const url = new URL(request.url);
    if (/(^|\.)extendthemix\.com$/i.test(url.hostname)) {
      url.pathname = '/extendo.html';
      return new Response(null, { headers: { 'x-middleware-rewrite': url.toString() } });
    }
  } catch (e) {}
  return new Response(null, { headers: { 'x-middleware-next': '1' } });
}
