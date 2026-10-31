// `pnpm dev`: the API and sign-in go to the Rust server; /dashboard/* is the
// dashboard's page (everything else falls back to the chat's index.html).
const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function (app) {
  app.use(createProxyMiddleware({ target: 'http://127.0.0.1:8080', pathFilter: ['/api', '/auth'], ws: false }));
  app.use((req, _res, next) => {
    if (/^\/dashboard(\/[^.]*)?$/.test(req.url.split('?')[0])) req.url = '/dashboard/index.html';
    next();
  });
};
