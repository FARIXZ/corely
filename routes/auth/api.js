import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

const router = express.Router();
const AUTH_FILE = path.join(process.cwd(), 'data', 'auth.json');
const SESSIONS_FILE = path.join(process.cwd(), 'data', 'sessions.json');

// Helper to reliably parse cookies
function parseCookies(cookieStr) {
  if (!cookieStr) return {};
  return cookieStr.split(';').reduce((res, c) => {
    const [key, val] = c.trim().split('=').map(decodeURIComponent);
    try {
      return Object.assign(res, { [key]: JSON.parse(val) });
    } catch (e) {
      return Object.assign(res, { [key]: val });
    }
  }, {});
}

async function getAuth() {
  try {
    const data = await fs.readFile(AUTH_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return null;
  }
}

async function getSessions() {
  try {
    const data = await fs.readFile(SESSIONS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    return {};
  }
}

async function saveSessions(sessions) {
  await fs.mkdir(path.dirname(SESSIONS_FILE), { recursive: true });
  await fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf-8');
}

// Authentication Middleware
export const requireAuth = async (req, res, next) => {
  const publicPaths = ['/login.html', '/setup.html', '/api/auth/setup', '/api/auth/login', '/api/auth/status', '/feather.min.js', '/favicon.ico'];
  
  if (publicPaths.includes(req.path) || req.path.startsWith('/cached-icons/')) {
    return next();
  }

  const auth = await getAuth();
  
  // No auth configured -> Redirect to setup
  if (!auth) {
    if (req.path.startsWith('/api/')) return res.status(403).json({ error: 'Setup required', needsSetup: true });
    return res.redirect('/setup.html');
  }

  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies.sessionId;

  if (sessionId) {
    const sessions = await getSessions();
    if (sessions[sessionId] && sessions[sessionId].expires > Date.now()) {
      // Valid session
      return next();
    }
  }

  // Not authenticated
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Unauthorized' });
  return res.redirect('/login.html');
};

// Check Status
router.get('/api/auth/status', async (req, res) => {
  const auth = await getAuth();
  if (!auth) return res.json({ needsSetup: true });
  
  const cookies = parseCookies(req.headers.cookie);
  const sessions = await getSessions();
  if (cookies.sessionId && sessions[cookies.sessionId] && sessions[cookies.sessionId].expires > Date.now()) {
    return res.json({ authenticated: true });
  }
  
  return res.json({ authenticated: false });
});

// Setup Initial Credentials
router.post('/api/auth/setup', async (req, res) => {
  const auth = await getAuth();
  if (auth) {
    return res.status(400).json({ error: 'Setup already complete.' });
  }

  const { username, password } = req.body;
  if (!username || !password || username.length < 3 || password.length < 5) {
    return res.status(400).json({ error: 'Invalid username or password length.' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');

  await fs.mkdir(path.dirname(AUTH_FILE), { recursive: true });
  await fs.writeFile(AUTH_FILE, JSON.stringify({ username, salt, hash }, null, 2), 'utf-8');

  // Auto login
  const sessionId = crypto.randomBytes(32).toString('hex');
  const sessions = await getSessions();
  sessions[sessionId] = { expires: Date.now() + 30 * 24 * 60 * 60 * 1000 }; // 30 days
  await saveSessions(sessions);

  res.cookie('sessionId', sessionId, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
  res.json({ success: true });
});

// Login
router.post('/api/auth/login', async (req, res) => {
  const auth = await getAuth();
  if (!auth) {
    return res.status(400).json({ error: 'System not set up yet.' });
  }

  const { username, password } = req.body;
  if (!username || !password || username !== auth.username) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const hash = crypto.scryptSync(password, auth.salt, 64).toString('hex');
  if (hash !== auth.hash) {
    return res.status(401).json({ error: 'Invalid credentials.' });
  }

  const sessionId = crypto.randomBytes(32).toString('hex');
  const sessions = await getSessions();
  sessions[sessionId] = { expires: Date.now() + 30 * 24 * 60 * 60 * 1000 }; // 30 days
  await saveSessions(sessions);

  res.cookie('sessionId', sessionId, { httpOnly: true, maxAge: 30 * 24 * 60 * 60 * 1000 });
  res.json({ success: true });
});

// Logout
router.post('/api/auth/logout', async (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies.sessionId;
  
  if (sessionId) {
    const sessions = await getSessions();
    delete sessions[sessionId];
    await saveSessions(sessions);
  }

  res.clearCookie('sessionId');
  res.json({ success: true });
});

export default router;
