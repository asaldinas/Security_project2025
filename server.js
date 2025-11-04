// server.js
require('dotenv').config();
const fs = require('fs');
const https = require('https');
const path = require('path');

const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { Issuer, generators } = require('openid-client');
const { v4: uuidv4 } = require('uuid');
const { z } = require('zod');
const crypto = require('crypto');

const DB = require('./db');

const {
  PORT = 3000,
  BASE_URL,
  SESSION_SECRET,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
} = process.env;

if (!BASE_URL || !SESSION_SECRET || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.error('Missing required env vars. Check .env.');
  process.exit(1);
}

const app = express();

// ---------- Security headers ----------
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'"],
      "style-src": ["'self'","'unsafe-inline'"],
      "img-src": ["'self'","data:"],
      "connect-src": ["'self'"],
      "frame-ancestors": ["'none'"], // no framing (anti-clickjacking)
    }
  },
  referrerPolicy: { policy: 'no-referrer' }
}));

// ---------- Rate limiting ----------
const apiLimiter = rateLimit({ windowMs: 60_000, max: 100 }); // 100 req/min per IP
app.use(apiLimiter);

// ---------- Parsers ----------
app.use(cookieParser());
app.use(express.json({ limit: '64kb' })); // input length limit

// ---------- Sessions (cookie only carries opaque id) ----------
app.set('trust proxy', 1); // if behind proxy in prod
app.use(session({
  name: 'campushub.sid',
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,       // JS can't read
    secure: true,         // HTTPS-only
    sameSite: 'lax',      // CSRF help
    maxAge: 30 * 60 * 1000, // 30 min
    path: '/',
  },
  rolling: true           // refresh expiration on activity
}));

// ---------- Static frontend ----------
app.use(express.static(path.join(__dirname, 'web'), {
  etag: true,
  cacheControl: true,
  maxAge: '5m'
}));

// ---------- OIDC (Google) ----------
let oidcClient;
let codeVerifier; // per-login; stored in session too

(async () => {
  const google = await Issuer.discover('https://accounts.google.com');
  oidcClient = new google.Client({
    client_id: GOOGLE_CLIENT_ID,
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uris: [`${BASE_URL}/callback`],
    response_types: ['code']
  });
})().catch(err => {
  console.error('OIDC init failed:', err);
  process.exit(1);
});

// ---------- Helpers ----------
function requireAuth(req, res, next) {
  if (req.session?.user) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

function requireCsrf(req, res, next) {
  const method = req.method.toUpperCase();
  if (!['POST','PUT','DELETE','PATCH'].includes(method)) return next();
  const token = req.get('x-csrf-token');
  if (!token || token !== req.session?.csrfToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  next();
}

function issueCsrf(req) {
  const token = crypto.randomBytes(24).toString('hex');
  req.session.csrfToken = token;
  return token;
}

// very small sanitizer against leading/trailing spaces and control chars
const noteSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(5000)
});

// ---------- Routes: Auth ----------
app.get('/login', async (req, res, next) => {
  try {
    const ver = generators.codeVerifier();
    const challenge = generators.codeChallenge(ver);
    req.session.pkce = ver;

    const url = oidcClient.authorizationUrl({
      scope: 'openid email profile',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      prompt: 'select_account'
    });
    res.redirect(url);
  } catch (e) { next(e); }
});

app.get('/callback', async (req, res, next) => {
  try {
    const params = oidcClient.callbackParams(req);
    const tokenSet = await oidcClient.callback(`${BASE_URL}/callback`, params, { code_verifier: req.session.pkce });
    const claims = tokenSet.claims(); // verified id_token claims

    // Store minimal identity in session
    req.session.user = {
      sub: claims.sub,
      email: claims.email,
      name: claims.name,
      picture: claims.picture
    };
    DB.upsertUser(req.session.user);

    issueCsrf(req); // new CSRF token each login
    res.redirect('/');
  } catch (e) { next(e); }
});

app.get('/logout', (req, res) => {
  // destroy server session then clear cookie
  req.session.destroy(() => {
    res.clearCookie('campushub.sid', {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/'
    });
    res.redirect('/');
  });
});

app.get('/me', (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Unauthorized' });
  res.json({ email: req.session.user.email, name: req.session.user.name, sub: req.session.user.sub });
});

// Issue CSRF token (short JSON, no-store)
app.get('/csrf', requireAuth, (req, res) => {
  const token = issueCsrf(req);
  res.set('Cache-Control', 'no-store');
  res.json({ token });
});

// ---------- Routes: Notes (owner only) ----------
app.use('/api', requireAuth, requireCsrf);

app.get('/api/notes', (req, res) => {
  const notes = DB.listNotes(req.session.user.sub);
  res.json(notes);
});

app.post('/api/notes', (req, res) => {
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });
  const id = uuidv4();
  DB.createNote(req.session.user.sub, { id, ...parsed.data });
  res.status(201).json({ id });
});

app.put('/api/notes/:id', (req, res) => {
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid input' });
  const ok = DB.updateNote(req.session.user.sub, req.params.id, parsed.data);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ updated: true });
});

app.delete('/api/notes/:id', (req, res) => {
  const ok = DB.deleteNote(req.session.user.sub, req.params.id);
  if (!ok) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// ---------- Errors ----------
app.use((req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

// ---------- HTTPS server ----------
const key = fs.readFileSync(path.join(__dirname, 'certs/localhost.key'));
const cert = fs.readFileSync(path.join(__dirname, 'certs/localhost.crt'));
https.createServer({ key, cert }, app).listen(PORT, () => {
  console.log(`CampusHub running at ${BASE_URL}`);
});
