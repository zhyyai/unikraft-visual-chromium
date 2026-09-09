const { chromium } = require('playwright');
const http = require('http');
const httpProxy = require('http-proxy');
const modifyResponse = require('node-http-proxy-json');
const sem = require('semaphore')(1);
const crypto = require('crypto');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const port = 8080;
const cdp_host = '127.0.0.1';
const cdp_port = 9222;
const DB_PATH = process.env.DB_PATH || '/app/data/tokens.db';
const BOOTSTRAP_ADMIN_TOKEN = process.env.BOOTSTRAP_ADMIN_TOKEN;

var devtoolsPath = "";

// Quiet logging - no verbose stdout flooding
function log(msg) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${msg}`);
}

// Token database initialization
const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    token TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used INTEGER,
    expires_at INTEGER,
    is_admin INTEGER DEFAULT 0
  )
`);

function createToken(name, expiresAt = null, isAdmin = false) {
    const token = 'k_' + crypto.randomBytes(24).toString('hex');
    db.prepare(`
        INSERT INTO tokens (token, name, created_at, expires_at, is_admin)
        VALUES (?, ?, ?, ?, ?)
    `).run(token, name, Date.now(), expiresAt, isAdmin ? 1 : 0);
    return token;
}

function validateToken(token) {
    const row = db.prepare('SELECT is_admin, expires_at FROM tokens WHERE token = ?').get(token);
    if (!row) return { valid: false };
    if (row.expires_at && Date.now() > row.expires_at) {
        db.prepare('DELETE FROM tokens WHERE token = ?').run(token);
        return { valid: false };
    }
    db.prepare('UPDATE tokens SET last_used = ? WHERE token = ?').run(Date.now(), token);
    return { valid: true, isAdmin: row.is_admin === 1 };
}

function revokeToken(token) {
    const result = db.prepare('DELETE FROM tokens WHERE token = ?').run(token);
    return result.changes > 0;
}

function listTokens() {
    return db.prepare('SELECT token, name, created_at, last_used, expires_at, is_admin FROM tokens').all().map(t => ({
        token: t.token.slice(0, 8) + '...',
        fullToken: t.token,
        name: t.name,
        createdAt: new Date(t.created_at).toISOString(),
        lastUsed: t.last_used ? new Date(t.last_used).toISOString() : null,
        expiresAt: t.expires_at ? new Date(t.expires_at).toISOString() : null,
        isAdmin: t.is_admin === 1,
    }));
}

function extractToken(req) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const queryToken = url.searchParams.get('token');
    if (queryToken) return queryToken;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7);
    }
    return null;
}

function authenticate(req) {
    const token = extractToken(req);
    if (!token) return { authenticated: false, isAdmin: false };
    if (BOOTSTRAP_ADMIN_TOKEN && token === BOOTSTRAP_ADMIN_TOKEN) {
        return { authenticated: true, isAdmin: true };
    }
    const result = validateToken(token);
    if (!result.valid) return { authenticated: false, isAdmin: false };
    return { authenticated: true, isAdmin: result.isAdmin };
}

function sendJson(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            try { resolve(JSON.parse(body)); }
            catch { reject(new Error('Invalid JSON')); }
        });
        req.on('error', reject);
    });
}

// Start browser with heavily optimized flags for 1 vCPU
async function startBrowser() {
    log("Launching optimized Chromium instance...");
    const profileDir = path.join(path.dirname(DB_PATH), 'chromium-profile');
    if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
    }

    const browser = await chromium.launch({
        headless: false,
        args: [
            `--remote-debugging-port=${cdp_port}`,
            '--remote-debugging-address=127.0.0.1',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--renderer-process-limit=4',
            '--disable-smooth-scrolling',
            '--enable-low-end-device-mode',
            '--disable-background-timer-throttling=false',
            '--disable-features=Translate,OptimizationHints,MediaRouter',
            '--window-size=1280,720',
            '--window-position=0,0',
            `--user-data-dir=${profileDir}`
        ]
    });
    log("Chromium launched successfully.");
    return browser;
}

// Setup HTTP & WebSocket Proxy
var proxy = httpProxy.createProxyServer({
    target: { host: cdp_host, port: cdp_port },
    ws: true
});

proxy.on('error', function (err, req, res) {
    log(`Proxy error: ${err.message}`);
    if (res && res.writeHead) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Proxy error', message: err.message }));
    }
});

var server = http.createServer(async function (req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname === '/health') {
        return sendJson(res, 200, { status: 'healthy', timestamp: new Date().toISOString() });
    }

    if (pathname.startsWith('/api/tokens')) {
        const auth = authenticate(req);
        if (!auth.authenticated || !auth.isAdmin) {
            return sendJson(res, 401, { error: 'Unauthorized. Admin access required.' });
        }
        if (req.method === 'GET' && pathname === '/api/tokens') {
            return sendJson(res, 200, { tokens: listTokens() });
        }
        if (req.method === 'POST' && pathname === '/api/tokens') {
            try {
                const body = await readBody(req);
                if (!body.name) return sendJson(res, 400, { error: 'Missing required field: name' });
                const token = createToken(body.name, body.expiresAt || null, body.isAdmin || false);
                return sendJson(res, 201, { token, name: body.name, expiresAt: body.expiresAt || null, isAdmin: body.isAdmin || false });
            } catch (err) {
                return sendJson(res, 400, { error: err.message });
            }
        }
        if (req.method === 'DELETE' && pathname.startsWith('/api/tokens/')) {
            const tokenToRevoke = pathname.slice('/api/tokens/'.length);
            const revoked = revokeToken(tokenToRevoke);
            return sendJson(res, revoked ? 200 : 404, { success: revoked });
        }
    }

    const auth = authenticate(req);
    if (!auth.authenticated) {
        return sendJson(res, 401, { error: 'Unauthorized' });
    }

    if (pathname === '/json/version') {
        modifyResponse(res, req.headers['content-encoding'], function (body) {
            if (body && body.webSocketDebuggerUrl) {
                const wsUrl = new URL(body.webSocketDebuggerUrl);
                devtoolsPath = wsUrl.pathname;
                const token = extractToken(req);
                const tokenParam = token ? `?token=${token}` : '';
                body.webSocketDebuggerUrl = `ws://${req.headers.host}${devtoolsPath}${tokenParam}`;
            }
            return body;
        });
    }

    proxy.web(req, res);
});

server.on('upgrade', function (req, socket, head) {
    const auth = authenticate(req);
    if (!auth.authenticated) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
    }
    proxy.ws(req, socket, head);
});

async function main() {
    await startBrowser();
    server.listen(port, '0.0.0.0', () => {
        log(`CDP Proxy listening on 0.0.0.0:${port}`);
    });
}

main().catch(err => {
    console.error("Fatal startup error:", err);
    process.exit(1);
});
