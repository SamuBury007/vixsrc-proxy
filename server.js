const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const cookieParser = require('cookie-parser');

const app = express();
const PORT = process.env.PORT || 3000;
const TARGET = 'https://vixsrc.to';

// Headers specifici per Tizen TV (WebKit)
const TIZEN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (SMART-TV; Linux; Tizen 6.0) AppleWebKit/538.1 (KHTML, like Gecko) SamsungBrowser/4.0 TV Safari/538.1',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'it-IT,it;q=0.9,en;q=0.8',
  'Accept-Encoding': 'gzip, deflate',
  'Referer': TARGET + '/',
  'Origin': TARGET,
  'Connection': 'keep-alive'
};

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());

// Disabilita tutti i blocchi di sicurezza che interferirebbero
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  res.setHeader('Content-Security-Policy', "frame-ancestors * 'self'");
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.removeHeader('X-Powered-By');
  next();
});

// Intercetta HTML per iniettare script compatibili con Tizen
app.use((req, res, next) => {
  const originalSend = res.send;
  res.send = function (body) {
    if (typeof body === 'string' && res.get('Content-Type')?.includes('text/html')) {
      // Rimuovi meta tag che bloccano l'iframe
      body = body.replace(/<meta[^>]*http-equiv=["'](?:X-Frame-Options|Content-Security-Policy)["'][^>]*>/gi, '');
      
      // Inietta script per Tizen (no ES6+ fancy stuff, WebKit vecchio)
      const injectScript = `
      <script>
        try {
          // Previeni rilevamento iframe
          var _origDomain = document.domain;
          if (window.top !== window.self) {
            // Bypass per browser vecchi (Tizen WebKit)
            window.console = window.console || { log: function(){}, error: function(){} };
            
            // Rimuovi blocchi anti-embed comuni
            var _blocked = ['__PHOENIX_JS__', '__cf_chl_opt', '___grecaptcha_cfg'];
            for (var i = 0; i < _blocked.length; i++) {
              if (window[_blocked[i]]) {
                try { delete window[_blocked[i]]; } catch(e) {}
              }
            }
            
            console.log('[TizenProxy] Bypass caricato');
          }
        } catch(e) {
          // Silenzioso - Tizen non supporta try/catch avanzati
        }
      </script>
      `;
      
      body = body.replace('</head>', injectScript + '</head>');
      
      // Riscrivi URL assoluti verso il proxy
      body = body.replace(/https?:\/\/vixsrc\.to\//g, '/');
      body = body.replace(/https?:\/\/vixsrc\.to([^\\/])/g, '/$1');
      
      // Riscrivi URL relativi al CDN se presenti
      body = body.replace(/\/\/[^\/]+\/cdn\//g, '//' + req.headers.host + '/cdn/');
    }
    return originalSend.call(this, body);
  };
  next();
});

// Proxy principale
app.use('/', createProxyMiddleware({
  target: TARGET,
  changeOrigin: true,
  selfHandleResponse: false,
  followRedirects: true,
  cookieDomainRewrite: {
    '*': ''
  },
  on: {
    proxyReq: (proxyReq, req, res) => {
      // Imposta headers Tizen
      Object.entries(TIZEN_HEADERS).forEach(([key, val]) => {
        proxyReq.setHeader(key, val);
      });
      
      // Forward cookies
      if (req.headers.cookie) {
        proxyReq.setHeader('Cookie', req.headers.cookie);
      }
      
      // Rimuovi tracce del proxy
      proxyReq.removeHeader('X-Forwarded-For');
      proxyReq.removeHeader('X-Forwarded-Host');
    },
    proxyRes: (proxyRes, req, res) => {
      // Rimuovi header restrittivi
      delete proxyRes.headers['x-frame-options'];
      delete proxyRes.headers['content-security-policy'];
      delete proxyRes.headers['x-content-type-options'];
      delete proxyRes.headers['strict-transport-security'];
      delete proxyRes.headers['x-xss-protection'];
      
      // Rewrite Set-Cookie per dominio proxy
      if (proxyRes.headers['set-cookie']) {
        proxyRes.headers['set-cookie'] = proxyRes.headers['set-cookie'].map(cookie => {
          return cookie.replace(/domain=[^;]+;/i, '');
        });
      }
      
      // Headers per embedding
      proxyRes.headers['access-control-allow-origin'] = '*';
      proxyRes.headers['x-frame-options'] = 'ALLOWALL';
      proxyRes.headers['content-security-policy'] = "frame-ancestors *";
    },
    error: (err, req, res) => {
      console.error('[Proxy Error]', err.message);
      if (!res.headersSent) {
        res.status(502).send(`
          <html><body>
          <h2>Errore Proxy</h2>
          <p>${err.message}</p>
          <p>Host: ${req.headers.host}</p>
          <p>Path: ${req.path}</p>
          </body></html>
        `);
      }
    }
  }
}));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════╗
║  VixSrc Proxy per Samsung Tizen TV   ║
║──────────────────────────────────────║
║  URL:    http://0.0.0.0:${PORT}         ║
║  Target: ${TARGET} ║
╚══════════════════════════════════════╝
  `);
});
