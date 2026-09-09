const http = require('http');
const httpProxy = require('http-proxy');
const { spawn } = require('child_process');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const port = 8080;
const cdp_host = '127.0.0.1';
const cdp_port = 9222;
const DB_PATH = process.env.DB_PATH || '/app/data/tokens.json';
const BOOTSTRAP_ADMIN_TOKEN = process.env.BOOTSTRAP_ADMIN_TOKEN;

function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

function loadTokens() {
    try {
        if (fs.existsSync(DB_PATH)) {
            return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
        }
    } catch (e) {
        log(`Failed to read tokens: ${e.message}`);
    }
    return {};
}

function saveTokens(tokens) {
    try {
        const tmp = `${DB_PATH}.tmp.${Date.now()}`;
        fs.writeFileSync(tmp, JSON.stringify(tokens, null, 2), 'utf8');
        fs.renameSync(tmp, DB_PATH);
    } catch (e) {
        log(`Failed to save tokens: ${e.message}`);
    }
}

function createToken(name, expiresAt = null, isAdmin = false) {
    const token = 'k_' + crypto.randomBytes(24).toString('hex');
    const tokens = loadTokens();
    tokens[token] = {
        token,
        name,
        created_at: Date.now(),
        last_used: null,
        expires_at: expiresAt,
        is_admin: isAdmin ? 1 : 0
    };
    saveTokens(tokens);
    return token;
}

function validateToken(token) {
    const tokens = loadTokens();
    const item = tokens[token];
    if (!item) return { valid: false };
    if (item.expires_at && Date.now() > item.expires_at) {
        delete tokens[token];
        saveTokens(tokens);
        return { valid: false };
    }
    item.last_used = Date.now();
    saveTokens(tokens);
    return { valid: true, isAdmin: item.is_admin === 1 };
}

function revokeToken(token) {
    const tokens = loadTokens();
    if (!tokens[token]) return false;
    delete tokens[token];
    saveTokens(tokens);
    return true;
}

function listTokens() {
    const tokens = loadTokens();
    return Object.values(tokens).map(t => ({
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
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=UTF-8',
        'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
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

function startChromium() {
    log('Spawning native optimized Chromium...');
    const profileDir = '/tmp/chromium-profile';
    if (!fs.existsSync(profileDir)) {
        fs.mkdirSync(profileDir, { recursive: true });
    }
    try {
        ['SingletonLock', 'SingletonSocket', 'SingletonCookie'].forEach(f => {
            const p = path.join(profileDir, f);
            if (fs.existsSync(p)) fs.unlinkSync(p);
        });
    } catch (e) {
        log(`Lock cleanup warning: ${e.message}`);
    }

    const args = [
        `--remote-debugging-port=${cdp_port}`,
        '--remote-debugging-address=0.0.0.0',
        '--remote-allow-origins=*',
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
        '--start-maximized',
        `--user-data-dir=${profileDir}`,
        'https://www.google.com'
    ];

    const child = spawn('chromium', args, {
        env: { ...process.env, DISPLAY: ':1' },
        stdio: 'ignore'
    });

    child.on('error', (err) => {
        log(`Chromium spawn error: ${err.message}`);
    });

    child.on('exit', (code) => {
        log(`Chromium exited with code ${code}. Respawning in 2s...`);
        setTimeout(startChromium, 2000);
    });

    log('Chromium process successfully started.');
}

const targetUrl = `http://${cdp_host}:${cdp_port}`;
const proxy = httpProxy.createProxyServer({
    target: targetUrl,
    changeOrigin: true,
    ws: true
});

proxy.on('error', function (err, req, res) {
    if (res && res.writeHead) {
        sendJson(res, 502, { error: 'Proxy error', message: err.message });
    }
});

const server = http.createServer(async function (req, res) {
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

    // Intercept JSON discovery endpoints to rewrite WebSocket URLs cleanly with accurate Content-Length
    if (pathname === '/json/version' || pathname === '/json' || pathname === '/json/list') {
        const cdpReq = http.get(`${targetUrl}${pathname}`, (cdpRes) => {
            let data = '';
            cdpRes.on('data', chunk => { data += chunk; });
            cdpRes.on('end', () => {
                try {
                    const clientHost = req.headers.host || 'localhost';
                    const token = extractToken(req);
                    const tokenParam = token ? `?token=${token}` : '';
                    function rewriteWs(urlStr) {
                        if (!urlStr) return urlStr;
                        try {
                            const wsUrl = new URL(urlStr);
                            return `ws://${clientHost}${wsUrl.pathname}${tokenParam}`;
                        } catch {
                            return urlStr;
                        }
                    }
                    let parsed = JSON.parse(data);
                    if (Array.isArray(parsed)) {
                        parsed.forEach(item => {
                            if (item.webSocketDebuggerUrl) item.webSocketDebuggerUrl = rewriteWs(item.webSocketDebuggerUrl);
                        });
                    } else if (parsed && typeof parsed === 'object') {
                        if (parsed.webSocketDebuggerUrl) parsed.webSocketDebuggerUrl = rewriteWs(parsed.webSocketDebuggerUrl);
                    }
                    sendJson(res, cdpRes.statusCode, parsed);
                } catch (err) {
                    sendJson(res, 500, { error: 'Failed to process CDP response', message: err.message });
                }
            });
        });
        cdpReq.on('error', (err) => {
            sendJson(res, 502, { error: 'CDP unreachable', message: err.message });
        });
        return;
    }

    req.headers['host'] = `${cdp_host}:${cdp_port}`;
    proxy.web(req, res, { target: targetUrl });
});

server.on('upgrade', function (req, socket, head) {
    const auth = authenticate(req);
    if (!auth.authenticated) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
    }
    req.headers['host'] = `${cdp_host}:${cdp_port}`;
    proxy.ws(req, socket, head, { target: targetUrl });
});

startChromium();
server.listen(port, '0.0.0.0', () => {
    log(`CDP Proxy listening on 0.0.0.0:${port}`);
});
