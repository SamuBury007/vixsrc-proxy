const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');

const app = express();
const PORT = process.env.PORT || 3000;
const TARGET = 'https://vixsrc.to';

// Headers falsi da browser reale
const REAL_BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
  'Accept-Encoding': 'gzip, deflate, br',
  'Sec-Ch-Ua': '"Not/A)Brand";v="99", "Google Chrome";v="125", "Chromium";v="125"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"Windows"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'Upgrade-Insecure-Requests': '1',
  'Priority': 'u=0, i',
  'Connection': 'keep-alive',
  'Cache-Control': 'max-age=0'
};

app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());

// Helmet configurato per NON bloccare nulla (altrimenti vanifica il proxy)
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: false,
  xFrameOptions: false,
  dnsPrefetchControl: false,
  frameguard: false
}));

// Intercetta le richieste HTML per iniettare script che bypassano i blocchi lato client
app.use((req, res, next) => {
  const originalSend = res.send;
  res.send = function (body) {
    if (typeof body === 'string' && res.get('Content-Type')?.includes('text/html')) {
      // Rimuovi meta tag CSP e X-Frame-Options
      body = body.replace(/<meta[^>]*http-equiv=["']X-Frame-Options["'][^>]*>/gi, '');
      body = body.replace(/<meta[^>]*http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');
      
      // Inietta script che forza l'iframe a funzionare anche con blocchi JS lato client
      const injectScript = `
      <script>
        // Bypassa eventuali controlli anti-iframe lato client
        if (window.top !== window.self) {
          // Forza la rimozione di eventuali blocchi
          Object.defineProperty(document, 'domain', { value: '${req.hostname}', writable: false });
          
          // Bypassa navigator.webdriver e altri controlli anti-bot
          Object.defineProperty(navigator, 'webdriver', { get: () => false });
          Object.defineProperty(navigator, 'plugins', { get: () => [1,2,3,4,5] });
          Object.defineProperty(navigator, 'languages', { get: () => ['it-IT', 'it', 'en-US', 'en'] });
          
          // Previeni che il sito rilevi l'iframe e si blocchi
          const originalCreateElement = document.createElement.bind(document);
          document.createElement = function(tagName, ...args) {
            const el = originalCreateElement(tagName, ...args);
            if (tagName.toLowerCase() === 'iframe') {
              // Rimuovi attributi sandbox restrittivi
              const originalSetAttribute = el.setAttribute.bind(el);
              el.setAttribute = function(name, value) {
                if (name.toLowerCase() === 'sandbox') return;
                return originalSetAttribute(name, value);
              };
            }
            return el;
          };
        }
        
        // Override di funzioni anti-embedding comuni
        const blockProps = ['__PHOENIX_JS__', '__cf', '_cf_chl_opt'];
        blockProps.forEach(prop => {
          if (window[prop]) delete window[prop];
        });

        console.log('[ProxyInject] Bypass attivi');
      </script>
      `;
      
      body = body.replace('</head>', injectScript + '</head>');
      
      // Forza tutti i link a passare dal proxy
      body = body.replace(/href="https?:\/\/vixsrc\.to/g, `href="/`);
      body = body.replace(/src="https?:\/\/vixsrc\.to/g, `src="/`);
      body = body.replace(/action="https?:\/\/vixsrc\.to/g, `action="/`);
    }
    return originalSend.call(this, body);
  };
  next();
});

// Endpoint speciale per le richieste API del player (spesso usano token)
app.get('/api/*', async (req, res) => {
  try {
    const apiUrl = TARGET + req.originalUrl;
    const response = await fetch(apiUrl, {
      headers: {
        ...REAL_BROWSER_HEADERS,
        'Referer': TARGET + '/',
        'Origin': TARGET,
        'X-Requested-With': 'XMLHttpRequest'
      }
    });
    const data = await response.text();
    res.set('Access-Control-Allow-Origin', '*');
    res.send(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Proxy principale
app.use('/', createProxyMiddleware({
  target: TARGET,
  changeOrigin: true,
  selfHandleResponse: false,
  followRedirects: true,
  preserveHeaderKeyCase: true,
  cookieDomainRewrite: {
    '*': req => req.hostname
  },
  on: {
    proxyReq: (proxyReq, req, res) => {
      // Headers browser reali
      Object.entries(REAL_BROWSER_HEADERS).forEach(([key, val]) => {
        proxyReq.setHeader(key, val);
      });
      
      // Headers specifici per request
      proxyReq.setHeader('Referer', TARGET + req.path);
      proxyReq.setHeader('Origin', TARGET);
      
      // Forward cookies se presenti
      if (req.cookies) {
        const cookieStr = Object.entries(req.cookies)
          .map(([k, v]) => `${k}=${v}`)
          .join('; ');
        if (cookieStr) proxyReq.setHeader('Cookie', cookieStr);
      }
      
      // Rimuovi headers che potrebbero farci scoprire come proxy
      proxyReq.removeHeader('X-Forwarded-For');
      proxyReq.removeHeader('X-Forwarded-Host');
      proxyReq.removeHeader('X-Forwarded-Proto');
    },
    proxyRes: (proxyRes, req, res) => {
      // Rimuovi TUTTI gli header restrittivi
      const blockHeaders = [
        'x-frame-options',
        'content-security-policy',
        'content-security-policy-report-only',
        'x-content-type-options',
        'x-xss-protection',
        'strict-transport-security',
        'access-control-allow-origin',
        'access-control-allow-methods',
        'access-control-allow-headers',
        'set-cookie' // Gestiamo i cookie manualmente
      ];
      
      blockHeaders.forEach(header => {
        delete proxyRes.headers[header];
      });
      
      // Permetti embedding
      proxyRes.headers['access-control-allow-origin'] = '*';
      proxyRes.headers['access-control-allow-credentials'] = 'true';
      proxyRes.headers['access-control-allow-methods'] = 'GET, POST, PUT, DELETE, OPTIONS, PATCH';
      proxyRes.headers['access-control-allow-headers'] = '*';
      proxyRes.headers['x-frame-options'] = 'ALLOWALL';
      proxyRes.headers['content-security-policy'] = "frame-ancestors *";
      
      // Permetti rendering iframe
      proxyRes.headers['cross-origin-embedder-policy'] = 'unsafe-none';
      proxyRes.headers['cross-origin-opener-policy'] = 'same-origin-allow-popups';
    },
    error: (err, req, res) => {
      console.error('Proxy error:', err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Proxy error', message: err.message });
      }
    }
  }
}));

// Gestione CORS preflight
app.options('*', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.set('Access-Control-Allow-Headers', '*');
  res.set('Access-Control-Allow-Credentials', 'true');
  res.status(204).send('');
});

app.listen(PORT, () => {
  console.log(`\n[VixSrc Proxy] Avviato su http://localhost:${PORT}`);
  console.log(`[VixSrc Proxy] Player accessibile via: http://localhost:${PORT}/`);
});
