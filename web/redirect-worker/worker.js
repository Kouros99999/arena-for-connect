// Permanent redirect of alias domains to arenaforconnect.com, keeping path and query.
// Deployed with: npx wrangler deploy (from this folder). Free tier.
export default {
  fetch(request) {
    const url = new URL(request.url);
    url.hostname = 'arenaforconnect.com';
    url.protocol = 'https:';
    url.port = '';
    return Response.redirect(url.toString(), 301);
  },
};
