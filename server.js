const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Target base
const TARGET = 'https://vixsrc.to';

app.use(cors({ origin: '*' }));

// Rimuovi header che bloccano iframe
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('X-Content-Type-Options');
  next();
});

// Proxy tutto verso vixsrc.to
app.use('/', createProxyMiddleware({
  target: TARGET,
  changeOrigin: true,
  selfHandleResponse: false,
  on: {
    proxyReq: (proxyReq, req, res) => {
      // Simula un browser reale
      proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) Version/6.0 TV Safari/538.1');
      proxyReq.setHeader('Referer', 'https://vixsrc.to/');
      proxyReq.setHeader('Origin', 'https://vixsrc.to');
      proxyReq.setHeader('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8');
      proxyReq.setHeader('Accept-Language', 'it-IT,it;q=0.9,en;q=0.8');
    },
    proxyRes: (proxyRes, req, res) => {
      // Rimuovi header restrittivi dalla risposta
      delete proxyRes.headers['x-frame-options'];
      delete proxyRes.headers['content-security-policy'];
      delete proxyRes.headers['x-content-type-options'];
      // Permetti embedding da qualsiasi origine
      proxyRes.headers['access-control-allow-origin'] = '*';
      proxyRes.headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
      proxyRes.headers['access-control-allow-headers'] = '*';
    },
    error: (err, req, res) => {
      console.error('Proxy error:', err.message);
      res.status(502).json({ error: 'Proxy error', message: err.message });
    }
  }
}));

app.listen(PORT, () => {
  console.log(`Proxy attivo su porta ${PORT}`);
});
