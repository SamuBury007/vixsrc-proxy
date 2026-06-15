const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Attiva il plugin stealth per bypassare rilevamento bot
puppeteer.use(StealthPlugin());

const app = express();
const PORT = process.env.PORT || 3000;
const TARGET = 'https://vixsrc.to';

// Middleware
app.use(cors({ origin: true, credentials: true }));

// Rimuovi header che bloccano iframe
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options');
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('X-Content-Type-Options');
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  res.setHeader('Content-Security-Policy', "frame-ancestors * 'self'");
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  next();
});

// CORS preflight
app.options('*', (req, res) => {
  res.status(204).send('');
});

// Stato del browser
let browser = null;
let page = null;
let lastActivity = Date.now();
const BROWSER_TIMEOUT = 5 * 60 * 1000; // Ricarica browser dopo 5 minuti

async function getBrowser() {
  const now = Date.now();
  
  // Ricrea browser se è scaduto o non esiste
  if (!browser || !browser.isConnected() || (now - lastActivity) > BROWSER_TIMEOUT) {
    if (browser) {
      try { await browser.close(); } catch(e) {}
    }
    
    console.log('[Puppeteer] Avvio browser...');
    
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--window-size=1920,1080',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-blink-features=AutomationControlled',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-component-extensions-with-background-pages',
        '--disable-component-update',
        '--disable-domain-reliability',
        '--disable-extensions',
        '--disable-features=Translate',
        '--disable-hang-monitor',
        '--disable-ipc-flooding-protection',
        '--disable-renderer-backgrounding',
        '--disable-sync',
        '--force-color-profile=srgb',
        '--metrics-recording-only',
        '--mute-audio',
        '--remote-debugging-port=0'
      ],
      defaultViewport: {
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1
      }
    });
    
    page = await browser.newPage();
    
    // Imposta headers come browser reale
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
    
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      'Accept-Encoding': 'gzip, deflate, br',
      'Sec-Ch-Ua': '"Not/A)Brand";v="99", "Google Chrome";v="125", "Chromium";v="125"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"'
    });
    
    // Script per bypassare controlli anti-bot lato client
    await page.evaluateOnNewDocument(() => {
      // Nascondi webdriver
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false
      });
      
      // Simula plugins reali
      Object.defineProperty(navigator, 'plugins', {
        get: () => [
          { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer' },
          { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai' },
          { name: 'Native Client', filename: 'internal-nacl-plugin' }
        ]
      });
      
      // Simula lingue
      Object.defineProperty(navigator, 'languages', {
        get: () => ['it-IT', 'it', 'en-US', 'en']
      });
      
      // Override chrome.runtime
      window.chrome = {
        runtime: {
          connect: () => ({ onMessage: { addListener: () => {} }, postMessage: () => {} }),
          sendMessage: () => {}
        }
      };
      
      // Override Permissions
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
          Promise.resolve({ state: Notification.permission }) :
          originalQuery(parameters)
      );
      
      // Previeni rilevamento headless
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return 'Intel Inc.';
        if (parameter === 37446) return 'Intel Iris OpenGL Engine';
        return getParameter(parameter);
      };
    });
    
    console.log('[Puppeteer] Browser pronto');
  }
  
  lastActivity = now;
  return { browser, page };
}

// Endpoint principale - gestisce tutte le richieste
app.get('*', async (req, res) => {
  try {
    const targetUrl = TARGET + req.path + (req.query ? '?' + new URLSearchParams(req.query).toString() : '');
    console.log(`[Request] ${req.path}`);
    
    const { page } = await getBrowser();
    
    // Naviga alla pagina target
    await page.goto(targetUrl, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    // Aspetta che eventuali challenge Cloudflare siano risolti
    await page.waitForTimeout(2000);
    
    // Ottieni il contenuto HTML
    let html = await page.content();
    
    // Pulisci l'HTML per permettere embedding in iframe
    html = html.replace(/<meta[^>]*http-equiv=["'](?:X-Frame-Options|Content-Security-Policy)["'][^>]*>/gi, '');
    html = html.replace(/<meta[^>]*http-equiv=["'](?:X-XSS-Protection)["'][^>]*>/gi, '');
    
    // Riscrivi URL assoluti per farli passare dal proxy
    html = html.replace(/https?:\/\/vixsrc\.to\//g, '/');
    html = html.replace(/https?:\/\/vixsrc\.to([^\/])/g, '/$1');
    
    // Inietta script per sicurezza iframe
    const injectScript = `
    <script>
      if (window.top !== window.self) {
        // Previeni che il sito blocchi l'iframe
        console.log('[Proxy] Pagina caricata in iframe');
      }
    </script>
    `;
    html = html.replace('</head>', injectScript + '</head>');
    
    // Invia la risposta
    res.send(html);
    
  } catch (err) {
    console.error('[Errore]', err.message);
    
    // Se c'è un errore di connessione, ricarica il browser
    if (err.message.includes('Protocol error') || err.message.includes('Target closed')) {
      if (browser) {
        try { await browser.close(); } catch(e) {}
        browser = null;
        page = null;
      }
    }
    
    // Mostra pagina di errore
    res.status(502).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Proxy Error</title>
        <style>
          body { font-family: Arial, sans-serif; text-align: center; padding: 50px; background: #1a1a2e; color: #eee; }
          .error { background: #16213e; padding: 30px; border-radius: 10px; max-width: 600px; margin: 0 auto; }
          h1 { color: #e94560; }
          p { color: #aaa; }
        </style>
      </head>
      <body>
        <div class="error">
          <h1>Errore Proxy</h1>
          <p>${err.message}</p>
          <p>Target: ${TARGET}</p>
          <p>Path: ${req.path}</p>
          <button onclick="location.reload()">Riprova</button>
        </div>
      </body>
      </html>
    `);
  }
});

// Endpoint per gestire risorse statice (JS, CSS, immagini)
app.get('/cdn/*', async (req, res) => {
  try {
    const targetUrl = TARGET + req.path;
    const { page } = await getBrowser();
    
    await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 15000 });
    
    // Prova a ottenere l'immagine/risorsa
    try {
      const img = await page.$('img');
      if (img) {
        const src = await img.evaluate(el => el.src);
        if (src) {
          res.redirect(src);
          return;
        }
      }
    } catch(e) {}
    
    const html = await page.content();
    res.send(html);
    
  } catch (err) {
    res.status(404).send('');
  }
});

// Pagina principale con iframe del player
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>VixSrc Proxy Player</title>
      <meta charset="UTF-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #000; overflow: hidden; }
        iframe {
          width: 100vw;
          height: 100vh;
          border: none;
        }
        #loading {
          position: fixed;
          top: 0; left: 0;
          width: 100%; height: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #000;
          color: #fff;
          font-family: Arial, sans-serif;
          font-size: 18px;
          z-index: 9999;
        }
        #loading .spinner {
          width: 50px;
          height: 50px;
          border: 3px solid #333;
          border-top: 3px solid #e94560;
          border-radius: 50%;
          animation: spin 1s linear infinite;
          margin: 0 auto 20px;
        }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .hidden { display: none !important; }
        #error {
          position: fixed;
          top: 50%; left: 50%;
          transform: translate(-50%, -50%);
          background: #1a1a2e;
          color: #e94560;
          padding: 30px;
          border-radius: 10px;
          font-family: Arial, sans-serif;
          text-align: center;
          z-index: 9998;
          display: none;
        }
      </style>
    </head>
    <body>
      <div id="loading">
        <div>
          <div class="spinner"></div>
          <div>Caricamento player in corso...</div>
        </div>
      </div>
      <div id="error"></div>
      <iframe id="player" src="/player" allowfullscreen></iframe>
      
      <script>
        var iframe = document.getElementById('player');
        var loading = document.getElementById('loading');
        var errorDiv = document.getElementById('error');
        
        iframe.onload = function() {
          loading.classList.add('hidden');
        };
        
        iframe.onerror = function() {
          loading.classList.add('hidden');
          errorDiv.style.display = 'block';
          errorDiv.innerHTML = '<h2>Errore di caricamento</h2><p>Riprova o aggiorna la pagina</p><button onclick="location.reload()">Aggiorna</button>';
        };
        
        // Timeout di 15 secondi
        setTimeout(function() {
          if (!loading.classList.contains('hidden')) {
            loading.classList.add('hidden');
            errorDiv.style.display = 'block';
            errorDiv.innerHTML = '<h2>Timeout</h2><p>Il player impiega troppo tempo a caricarsi</p><button onclick="location.reload()">Riprova</button>';
          }
        }, 15000);
      </script>
    </body>
    </html>
  `);
});

// Endpoint player principale
app.get('/player', async (req, res) => {
  try {
    const { page } = await getBrowser();
    
    console.log('[Player] Navigo alla home di vixsrc.to...');
    
    await page.goto(TARGET, {
      waitUntil: 'networkidle2',
      timeout: 30000
    });
    
    await page.waitForTimeout(3000);
    
    // Controlla se siamo bloccati da Cloudflare
    const pageTitle = await page.title();
    const bodyText = await page.evaluate(() => document.body.innerText);
    
    if (bodyText.includes('Spiacenti') || bodyText.includes('bloccato') || bodyText.includes('Attention Required') || bodyText.includes('Cloudflare')) {
      console.log('[Player] Rilevato blocco Cloudflare, attendo risoluzione...');
      await page.waitForTimeout(5000);
    }
    
    let html = await page.content();
    
    // Pulisci per iframe
    html = html.replace(/<meta[^>]*http-equiv=["'](?:X-Frame-Options|Content-Security-Policy)["'][^>]*>/gi, '');
    html = html.replace(/https?:\/\/vixsrc\.to\//g, '/');
    html = html.replace(/https?:\/\/vixsrc\.to([^\/])/g, '/$1');
    
    // Inietta script per mantenere funzionalità in iframe
    const injectScript = `
    <script>
      // Forza il caricamento di tutte le risorse via proxy
      (function() {
        var originalFetch = window.fetch;
        window.fetch = function(url, options) {
          if (typeof url === 'string' && url.startsWith('http')) {
            url = url.replace('https://vixsrc.to/', '/');
            url = url.replace('https://vixsrc.to', '/');
          }
          return originalFetch.call(this, url, options);
        };
        
        var originalXHR = window.XMLHttpRequest;
        var XHRProxy = function() {
          var xhr = new originalXHR();
          var originalOpen = xhr.open;
          xhr.open = function(method, url) {
            if (typeof url === 'string' && url.startsWith('http')) {
              url = url.replace('https://vixsrc.to/', '/');
              url = url.replace('https://vixsrc.to', '/');
            }
            return originalOpen.apply(this, arguments);
          };
          return xhr;
        };
        window.XMLHttpRequest = XHRProxy;
      })();
    </script>
    `;
    html = html.replace('</head>', injectScript + '</head>');
    
    res.removeHeader('X-Frame-Options');
    res.removeHeader('Content-Security-Policy');
    res.setHeader('X-Frame-Options', 'ALLOWALL');
    res.setHeader('Content-Security-Policy', "frame-ancestors *");
    res.setHeader('Access-Control-Allow-Origin', '*');
    
    res.send(html);
    
  } catch (err) {
    console.error('[Player Error]', err.message);
    res.status(502).send('Errore nel caricamento del player');
  }
});

// Gestione errori 404
app.use((req, res) => {
  res.status(404).send('Not found');
});

// Avvio server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║         VixSrc Proxy - Cloudflare Bypass         ║
║──────────────────────────────────────────────────║
║  Server:   http://0.0.0.0:${PORT}                   ║
║  Target:   ${TARGET}  ║
║  Player:   http://0.0.0.0:${PORT}/                  ║
║──────────────────────────────────────────────────║
║  Browser:  Puppeteer + Stealth Plugin            ║
║  Status:   IN ASCOLTO                            ║
╚══════════════════════════════════════════════════╝
  `);
});

// Gestione chiusura pulita
process.on('SIGINT', async () => {
  console.log('\n[Server] Chiusura in corso...');
  if (browser) {
    try { await browser.close(); } catch(e) {}
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (browser) {
    try { await browser.close(); } catch(e) {}
  }
  process.exit(0);
});
