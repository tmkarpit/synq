import { createHash, randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import { OAuth2Client } from 'google-auth-library';
import { OtpError, Verifier } from './otp.js';
import { GitHubError } from './github.js';
import { accountMember } from './permissions.js';

// Accounts: stored in MongoDB (users, refresh_tokens, login_history; see db/mongoStore.js).
//
// Two tokens, the usual split:
//   access token   a JWT (HS256, 15 minutes) the client keeps in memory and sends as
//                  "Authorization: Bearer" and in the Socket.IO handshake. Stateless.
//   refresh token  a random value in an httpOnly cookie limited to /api/auth, so page
//                  scripts never see it and it only travels to the auth endpoints. Only
//                  its SHA-256 hash is stored. Every refresh replaces it (rotation); a
//                  replaced token used again outside a short grace window means it was
//                  copied, and the whole login (its family) is revoked.
// Passwords are hashed with scrypt and a random salt.

const scrypt = promisify(scryptCb);
const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEY_LEN = 64;
const ACCESS_TTL = '15m';
const REFRESH_DAYS = 30;
const GRACE_SECONDS = 30; // two tabs refreshing at the same moment both succeed
const JWT_OPTIONS = { algorithm: 'HS256', issuer: 'synq', audience: 'synq' };
export const REFRESH_COOKIE = 'synq_refresh';

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const PHONE = /^\+[1-9]\d{7,14}$/;
const NAME = /^[\p{L}\p{N} _.-]{2,24}$/u;

export class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const publicUser = (doc) => ({ id: doc._id, email: doc.email, name: doc.name });

async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LEN, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function checkPassword(password, stored) {
  const [kind, N, r, p, salt, key] = String(stored).split('$');
  if (kind !== 'scrypt') return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: +N, r: +r, p: +p });
  return timingSafeEqual(actual, expected);
}

// Compared against when the email is unknown, so both cases take the same time.
const DUMMY_HASH = hashPassword('not-a-real-password');

export class Accounts {
  /**
   * secret: 32+ random characters (JWT_SECRET).
   * sender: senders.js (email and SMS for verification codes).
   * googleClientId: OAuth client id for "Continue with Google" (GOOGLE_CLIENT_ID).
   * verifyGoogle: (credential) => Google ID token payload; tests replace it.
   * defaultCountry: dialling code for numbers typed without one (DEFAULT_COUNTRY_CODE).
   */
  constructor({ db, secret, secureCookies = false, sender = null, googleClientId = '', verifyGoogle = null, defaultCountry = '91' }) {
    if (!secret || secret.length < 32) throw new Error('JWT_SECRET must be at least 32 characters.');
    if (secret.startsWith('change-me')) throw new Error('JWT_SECRET is still the example value. Set your own random secret.');
    this.users = db?.collection('users');
    this.tokens = db?.collection('refresh_tokens');
    this.rooms = db?.collection('rooms');
    this.history = db?.collection('login_history');
    this.secret = secret;
    this.secureCookies = secureCookies;
    this.attempts = new Map(); // ip|email -> { count, until }
    this.sender = sender;
    this.otp = new Verifier({ db, secret, sender });
    this.googleClientId = googleClientId;
    this.defaultCountry = String(defaultCountry).replace(/\D/g, '');
    const google = googleClientId ? new OAuth2Client(googleClientId) : null;
    this.verifyGoogle =
      verifyGoogle ||
      (async (credential) => (await google.verifyIdToken({ idToken: credential, audience: googleClientId })).getPayload());
  }

  /** What the login page may offer. */
  config() {
    return {
      google: this.googleClientId || null,
      email: !!this.sender?.email,
      sms: !!this.sender?.sms,
      devCodes: !!this.sender?.devLog,
    };
  }

  /* ------------------------------------------------------------ tokens */

  accessToken(user) {
    return jwt.sign({ name: user.name, email: user.email, typ: 'access' }, this.secret, {
      ...JWT_OPTIONS,
      subject: user.id,
      expiresIn: ACCESS_TTL,
    });
  }

  /** The user in a valid access token, or null (expired, tampered, wrong type). */
  verifyAccess(token) {
    if (!token || typeof token !== 'string') return null;
    try {
      const claims = jwt.verify(token, this.secret, { algorithms: ['HS256'], issuer: 'synq', audience: 'synq' });
      if (claims.typ !== 'access') return null;
      return { id: claims.sub, name: claims.name, email: claims.email };
    } catch {
      return null;
    }
  }

  async issueRefresh(userId, family = randomUUID()) {
    const token = randomBytes(32).toString('base64url');
    await this.tokens.insertOne({
      _id: randomUUID(),
      userId,
      family,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + REFRESH_DAYS * 86400_000),
      revokedAt: null,
      revokedReason: null,
      createdAt: new Date(),
    });
    return token;
  }

  /** { user, accessToken, refreshToken } for a fresh login. */
  async session(user) {
    return { user, accessToken: this.accessToken(user), refreshToken: await this.issueRefresh(user.id) };
  }

  /**
   * Trades a refresh token for a new pair (rotation). Throws 401 when it is not valid.
   *
   * The usual case: retire the token atomically if it is live, and add its successor in
   * the same family. Only when that finds nothing do we look closer: a token retired
   * seconds ago by another tab (grace), or a retired token coming back (reuse: end the
   * whole login).
   */
  async refresh(token) {
    if (!token || token.length > 100) throw new AuthError(401, 'Not signed in.');
    const hash = sha256(token);
    const now = new Date();
    const live = await this.tokens.findOneAndUpdate(
      { tokenHash: hash, revokedAt: null, expiresAt: { $gt: now } },
      { $set: { revokedAt: now, revokedReason: 'rotated' } },
    );
    let old = live;
    if (!old) {
      old = await this.tokens.findOne({ tokenHash: hash });
      if (!old || old.expiresAt <= now) throw new AuthError(401, 'Your login has expired. Log in again.');
      const inGrace = old.revokedReason === 'rotated' && now - old.revokedAt < GRACE_SECONDS * 1000;
      if (!inGrace) {
        // A replaced token came back: someone has a copy. End that whole login.
        await this.tokens.updateMany({ family: old.family, revokedAt: null }, { $set: { revokedAt: now } });
        await this.tokens.updateMany({ family: old.family }, { $set: { revokedReason: 'reused' } });
        throw new AuthError(401, 'This login was ended for safety. Log in again.');
      }
      // Two tabs refreshed at the same moment: the slower one gets its own successor too.
    }
    const user = await this.users.findOne({ _id: old.userId });
    if (!user) throw new AuthError(401, 'Your login has expired. Log in again.');
    return this.signedIn(publicUser(user), await this.issueRefresh(user._id, old.family));
  }

  signedIn(user, refreshToken) {
    return { user, accessToken: this.accessToken(user), refreshToken };
  }

  /** Ends the login the refresh token belongs to (every token of its family). Resolves its user id. */
  async logout(token) {
    if (!token) return null;
    const row = await this.tokens.findOne({ tokenHash: sha256(token) });
    if (!row) return null;
    await this.tokens.updateMany({ family: row.family, revokedAt: null }, { $set: { revokedAt: new Date(), revokedReason: 'logout' } });
    return row.userId;
  }

  /* ------------------------------------------------------------ history */

  /**
   * Adds a row to login_history: every signup, login, failed login and logout, kept for
   * good (browse it in Compass or Atlas). Never fails the request it describes.
   */
  async record({ event, method = null, user = null, userId = null, email = null, phone = null, ip = null, userAgent = null, reason = null }) {
    if (!this.history) return;
    try {
      let name = user?.name ?? null;
      if (!user && userId) {
        const u = await this.users.findOne({ _id: userId }, { projection: { email: 1, name: 1 } });
        email ??= u?.email ?? null;
        name = u?.name ?? null;
      }
      await this.history.insertOne({
        _id: randomUUID(),
        at: new Date(),
        event,
        method,
        userId: user?.id ?? userId,
        email: user?.email ?? email,
        name,
        phone,
        ip,
        userAgent,
        reason,
      });
    } catch (err) {
      console.error('[synq] could not save login history:', err.message);
    }
  }

  /** Who a code was for (to log a wrong code), or null. */
  async codeInfo(id) {
    return this.otp.codes?.findOne({ _id: String(id || '') }, { projection: { purpose: 1, channel: 1, target: 1, userId: 1 } }) ?? null;
  }

  /* ------------------------------------------------------------ users */

  /** "+919876543210" from what people type ("98765 43210", "+91-98765-43210"). */
  normalizePhone(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return null;
    const digits = trimmed.replace(/[\s().-]/g, '');
    const phone = digits.startsWith('+') ? digits : `+${this.defaultCountry}${digits.replace(/^0+/, '')}`;
    if (!PHONE.test(phone)) throw new AuthError(400, 'Enter a valid phone number, e.g. +91 98765 43210.');
    return phone;
  }

  requireChannel(channel) {
    if (!(channel === 'sms' ? this.sender?.sms : this.sender?.email)) {
      throw new AuthError(503, channel === 'sms' ? 'SMS codes are not set up on this server yet.' : 'Email codes are not set up on this server yet.');
    }
  }

  validate({ name, email, password }, signup) {
    const cleanEmail = String(email || '').trim().toLowerCase();
    if (!EMAIL.test(cleanEmail)) throw new AuthError(400, 'Enter a valid email address.');
    const pass = String(password || '');
    if (signup && pass.length < 8) throw new AuthError(400, 'Use at least 8 characters for the password.');
    if (signup && pass.trim().toLowerCase() === cleanEmail) throw new AuthError(400, "Don't use your email address as the password.");
    if (!pass) throw new AuthError(400, 'Enter your password.');
    if (pass.length > 200) throw new AuthError(400, 'That password is too long.');
    const cleanName = String(name || '').trim();
    if (signup && !NAME.test(cleanName)) {
      throw new AuthError(400, 'Use 2 to 24 letters, numbers, spaces, dots, dashes or underscores for your name.');
    }
    return { name: cleanName, email: cleanEmail, password: pass };
  }

  /** At most 10 tries per key in 10 minutes (login per address+email, signup per address). */
  limit(key) {
    const now = Date.now();
    if (this.attempts.size > 10_000) {
      for (const [k, v] of this.attempts) if (v.until <= now) this.attempts.delete(k);
    }
    const entry = this.attempts.get(key);
    if (entry && entry.until > now && entry.count >= 10) throw new AuthError(429, 'Too many attempts. Wait a few minutes and try again.');
    if (!entry || entry.until <= now) this.attempts.set(key, { count: 1, until: now + 10 * 60 * 1000 });
    else entry.count += 1;
  }

  /**
   * Starts a sign-up: nothing is created until the code sent to the email is entered
   * (verifyCode). Resolves { verify } describing where the code went.
   */
  async signup(input, ip = '') {
    const { name, email, password } = this.validate(input, true);
    const phone = this.normalizePhone(input.phone);
    this.limit(`signup|${ip}`);
    this.requireChannel('email');
    const taken = await this.users.findOne({ emailLower: email }, { projection: { _id: 1 } });
    if (taken) throw new AuthError(409, 'An account with this email already exists. Log in instead.');
    if (phone && (await this.phoneTaken(phone))) throw new AuthError(409, 'This phone number is already used by another account.');
    const payload = { name, passwordHash: await hashPassword(password), phone };
    return { verify: await this.otp.create({ purpose: 'signup', channel: 'email', target: email, payload }) };
  }

  async phoneTaken(phone, exceptUserId = null) {
    const other = await this.users.findOne(
      { phone, phoneVerifiedAt: { $type: 'date' }, ...(exceptUserId ? { _id: { $ne: exceptUserId } } : {}) },
      { projection: { _id: 1 } },
    );
    return !!other;
  }

  /**
   * Login with a code instead of a password: identifier is an email or a phone number.
   * Unknown addresses get a code request too (that is never sent), so the answer does
   * not reveal who has an account.
   */
  async requestLoginCode({ identifier } = {}, ip = '') {
    const raw = String(identifier || '').trim();
    if (!raw) throw new AuthError(400, 'Enter your email or phone number.');
    const channel = raw.includes('@') ? 'email' : 'sms';
    const target = channel === 'email' ? raw.toLowerCase() : this.normalizePhone(raw);
    if (channel === 'email' && !EMAIL.test(target)) throw new AuthError(400, 'Enter a valid email address.');
    this.limit(`code|${ip}`);
    this.requireChannel(channel);
    const found = await this.users.findOne(
      channel === 'email' ? { emailLower: target } : { phone: target, phoneVerifiedAt: { $type: 'date' } },
      { projection: { _id: 1 } },
    );
    const userId = found?._id ?? null;
    return { verify: await this.otp.create({ purpose: 'login', channel, target, userId, deliver: !!userId }) };
  }

  /** Adds or changes the signed-in user's phone: verified by a code sent to it. */
  async requestPhoneCode(userId, { phone: raw } = {}) {
    const phone = this.normalizePhone(raw);
    if (!phone) throw new AuthError(400, 'Enter your phone number.');
    this.requireChannel('sms');
    if (await this.phoneTaken(phone, userId)) throw new AuthError(409, 'This phone number is already used by another account.');
    return { verify: await this.otp.create({ purpose: 'phone', channel: 'sms', target: phone, userId }) };
  }

  async resendCode({ id } = {}) {
    return { verify: await this.otp.resend(id) };
  }

  /**
   * Checks a code and does what it was for:
   *   signup -> creates the account (email verified) and logs in; asks for the phone code next
   *   login  -> logs in
   *   phone  -> saves the verified phone (only for the signed-in user who asked)
   */
  async verifyCode({ id, code } = {}, signedInUser = null) {
    const row = await this.otp.verify(id, code, (r) => {
      if (r.purpose === 'phone' && signedInUser?.id !== r.userId) {
        throw new AuthError(403, 'Log in to the account that asked for this code.');
      }
    });
    if (row.purpose === 'signup') {
      const { name, passwordHash, phone } = row.payload || {};
      const created = await this.createUser({ email: row.target, name, passwordHash });
      if (!created) throw new AuthError(409, 'An account with this email already exists. Log in instead.');
      const session = await this.session(publicUser(created));
      session.purpose = 'signup';
      if (phone && this.sender?.sms && !(await this.phoneTaken(phone))) {
        session.next = await this.otp.create({ purpose: 'phone', channel: 'sms', target: phone, userId: created._id }).catch(() => null);
      }
      return session;
    }
    if (row.purpose === 'login') {
      if (!row.userId) throw new AuthError(400, 'That code is not right.');
      const user = await this.users.findOne({ _id: row.userId });
      if (!user) throw new AuthError(400, 'That code is not right.');
      if (row.channel === 'email' && !user.emailVerifiedAt) await this.users.updateOne({ _id: user._id }, { $set: { emailVerifiedAt: new Date() } });
      return { ...(await this.session(publicUser(user))), purpose: 'login', channel: row.channel };
    }
    // phone (the guard above made sure it is the account that asked)
    if (await this.phoneTaken(row.target, row.userId)) throw new AuthError(409, 'This phone number is already used by another account.');
    await this.users.updateOne({ _id: row.userId }, { $set: { phone: row.target, phoneVerifiedAt: new Date() } });
    return { account: await this.account(row.userId) };
  }

  /**
   * "Continue with Google": the credential is a Google ID token. Signs in the account
   * linked to that Google account, or the account with the same (Google-verified) email
   * (and links it), or creates a new one.
   */
  async googleLogin({ credential } = {}) {
    if (!this.googleClientId) throw new AuthError(503, 'Google sign-in is not set up on this server yet.');
    let info;
    try {
      info = await this.verifyGoogle(String(credential || ''));
    } catch {
      throw new AuthError(401, 'Google sign-in failed. Try again.');
    }
    if (!info?.sub || !info.email || info.email_verified !== true) throw new AuthError(401, 'Google did not confirm this email address.');
    const email = info.email.toLowerCase();
    const linked = await this.users.findOne({ googleSub: info.sub });
    if (linked) return this.session(publicUser(linked));
    const byEmail = await this.users.findOneAndUpdate(
      { emailLower: email, googleSub: null },
      // An update pipeline: link Google, and mark the email verified only if it was not yet.
      [{ $set: { googleSub: info.sub, emailVerifiedAt: { $ifNull: ['$emailVerifiedAt', '$$NOW'] } } }],
      { returnDocument: 'after' },
    );
    if (byEmail) return this.session(publicUser(byEmail));
    const cleaned = String(info.name || email.split('@')[0]).replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 24);
    const name = NAME.test(cleaned) ? cleaned : `user-${info.sub.slice(-6)}`;
    const created = await this.createUser({ email, name, passwordHash: null, googleSub: info.sub });
    if (!created) throw new AuthError(409, 'This email is linked to a different Google account.');
    return { ...(await this.session(publicUser(created))), purpose: 'signup' };
  }

  /** Inserts a verified account. Resolves the document, or null if the email is taken. */
  async createUser({ email, name, passwordHash, googleSub = null }) {
    const doc = {
      _id: randomUUID(),
      email,
      emailLower: email.toLowerCase(),
      name,
      passwordHash,
      emailVerifiedAt: new Date(),
      phone: null,
      phoneVerifiedAt: null,
      googleSub,
      createdAt: new Date(),
    };
    try {
      await this.users.insertOne(doc);
      return doc;
    } catch (err) {
      if (err?.code === 11000) return null; // duplicate email
      throw err;
    }
  }

  /** The signed-in user's profile for the Account page. */
  async account(userId) {
    const u = await this.users.findOne({ _id: userId });
    if (!u) throw new AuthError(401, 'Not signed in.');
    return {
      id: u._id,
      name: u.name,
      email: u.email,
      emailVerified: !!u.emailVerifiedAt,
      phone: u.phoneVerifiedAt ? u.phone : null,
      google: !!u.googleSub,
      hasPassword: !!u.passwordHash,
      createdAt: u.createdAt,
    };
  }

  async login(input, ip = '') {
    const { email, password } = this.validate(input, false);
    this.limit(`${ip}|${email}`);
    const user = await this.users.findOne({ emailLower: email });
    const ok = await checkPassword(password, user?.passwordHash ?? (await DUMMY_HASH));
    if (!user || !user.passwordHash || !ok) throw new AuthError(401, 'Wrong email or password.');
    this.attempts.delete(`${ip}|${email}`);
    return this.session(publicUser(user));
  }

  /** Rooms the user owns or was accepted into, most recently used first. */
  async roomsOf(userId) {
    const member = accountMember(userId);
    const rows = await this.rooms
      .find(
        { $or: [{ 'meta.owner': member }, { [`meta.members.${member}`]: { $exists: true } }] },
        { projection: { meta: 1, updatedAt: 1 } },
      )
      .sort({ updatedAt: -1 })
      .limit(50)
      .toArray();
    return rows.map((r) => ({
      id: r._id,
      name: r.meta?.name ?? null,
      role: r.meta?.owner === member ? 'owner' : r.meta?.members?.[member]?.role || 'editor',
      updatedAt: r.updatedAt,
    }));
  }

  /* ------------------------------------------------------------ cookie */

  cookie(token) {
    const parts = [`${REFRESH_COOKIE}=${token}`, 'Path=/api/auth', 'HttpOnly', 'SameSite=Lax', `Max-Age=${REFRESH_DAYS * 86400}`];
    if (this.secureCookies) parts.push('Secure');
    return parts.join('; ');
  }

  clearCookie() {
    return `${REFRESH_COOKIE}=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0`;
  }
}

export function readCookie(header, name = REFRESH_COOKIE) {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

const bearer = (req) => /^Bearer (.+)$/i.exec(String(req.headers.authorization || ''))?.[1] ?? null;

async function readJson(req) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new AuthError(415, 'Send JSON.');
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) throw new AuthError(413, 'Request too large.');
  }
  try {
    return JSON.parse(body || '{}');
  } catch {
    throw new AuthError(400, 'Invalid JSON.');
  }
}

/**
 * HTTP routes. Resolves true when it handled the request.
 *   GET  /api/auth/config                              -> { google, email, sms, devCodes }
 *   POST /api/auth/signup  { name, email, password, phone? } -> { verify } (a code is emailed)
 *   POST /api/auth/verify  { id, code }               -> signup/login: { user, accessToken, next? } + cookie;
 *                                                        phone (Bearer): { account }
 *   POST /api/auth/resend  { id }                     -> { verify }
 *   POST /api/auth/code    { identifier }             -> { verify } (log in with a code)
 *   POST /api/auth/phone   { phone } (Bearer)         -> { verify } (SMS code)
 *   POST /api/auth/google  { credential }             -> { user, accessToken } + cookie
 *   GET  /api/auth/account (Bearer)                   -> { account }
 *   POST /api/auth/login   { email, password }        -> { user, accessToken } + refresh cookie
 *   POST /api/auth/refresh (refresh cookie)           -> { user, accessToken } + new cookie ({ user: null } without one)
 *   POST /api/auth/logout  (refresh cookie)           -> { ok }, cookie cleared
 *   GET  /api/auth/me      (Bearer)                   -> { user }
 *   GET  /api/rooms        (Bearer)                   -> { rooms }
 *   GET  /api/github       (Bearer)                   -> { connected, login }
 *   POST /api/github/token { token } (Bearer)          -> { login } (checked with GitHub, stored encrypted)
 *   DELETE /api/github/token (Bearer)                  -> { connected: false }
 */
export function createAccountRoutes(accounts, github = null) {
  const send = (res, status, data, cookie) => {
    res.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
      ...(cookie ? { 'set-cookie': cookie } : {}),
    });
    res.end(JSON.stringify(data));
  };
  const signedIn = ({ user, accessToken, refreshToken, next }, res) =>
    send(res, 200, { user, accessToken, ...(next ? { next } : {}) }, accounts.cookie(refreshToken));
  const requireUser = (req) => {
    const user = accounts.verifyAccess(bearer(req));
    if (!user) throw new AuthError(401, 'Not signed in.');
    return user;
  };

  return async (req, res) => {
    const path = req.url.split('?')[0];
    if (!path.startsWith('/api/auth/') && path !== '/api/rooms' && !(github && (path === '/api/github' || path === '/api/github/token'))) return false;
    const refreshToken = readCookie(req.headers.cookie);
    const ip = req.socket.remoteAddress;
    // Through the Vite dev proxy every request comes from this machine; the proxy passes the
    // real address on. Only trusted from a local proxy, since anyone can send the header.
    const forwarded = /^(127\.|::1$|::ffff:127\.)/.test(ip || '') ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
    const log = (entry) =>
      accounts.record({ ip: forwarded || ip || null, userAgent: String(req.headers['user-agent'] || '').slice(0, 300) || null, ...entry });
    let body = null;
    try {
      if (req.method === 'GET' && path === '/api/auth/config') {
        send(res, 200, accounts.config());
      } else if (req.method === 'POST' && path === '/api/auth/signup') {
        send(res, 200, await accounts.signup(await readJson(req), ip));
      } else if (req.method === 'POST' && path === '/api/auth/verify') {
        body = await readJson(req);
        const result = await accounts.verifyCode(body, accounts.verifyAccess(bearer(req)));
        if (result.purpose) await log({ event: result.purpose, method: `${result.channel || 'email'} code`, user: result.user });
        if (result.refreshToken) signedIn(result, res);
        else send(res, 200, result);
      } else if (req.method === 'POST' && path === '/api/auth/resend') {
        send(res, 200, await accounts.resendCode(await readJson(req)));
      } else if (req.method === 'POST' && path === '/api/auth/code') {
        send(res, 200, await accounts.requestLoginCode(await readJson(req), ip));
      } else if (req.method === 'POST' && path === '/api/auth/phone') {
        send(res, 200, await accounts.requestPhoneCode(requireUser(req).id, await readJson(req)));
      } else if (req.method === 'POST' && path === '/api/auth/google') {
        body = await readJson(req);
        const result = await accounts.googleLogin(body);
        await log({ event: result.purpose || 'login', method: 'google', user: result.user });
        signedIn(result, res);
      } else if (req.method === 'GET' && path === '/api/auth/account') {
        send(res, 200, { account: await accounts.account(requireUser(req).id) });
      } else if (req.method === 'POST' && path === '/api/auth/login') {
        body = await readJson(req);
        const result = await accounts.login(body, ip);
        await log({ event: 'login', method: 'password', user: result.user });
        signedIn(result, res);
      } else if (req.method === 'POST' && path === '/api/auth/refresh') {
        await readJson(req); // JSON only, so another site cannot post a plain form here
        // No cookie at all just means "not logged in": a normal answer, not an error.
        if (!refreshToken) send(res, 200, { user: null });
        else signedIn(await accounts.refresh(refreshToken), res);
      } else if (req.method === 'POST' && path === '/api/auth/logout') {
        const userId = await accounts.logout(refreshToken);
        if (userId) await log({ event: 'logout', userId });
        send(res, 200, { ok: true }, accounts.clearCookie());
      } else if (req.method === 'GET' && path === '/api/auth/me') {
        send(res, 200, { user: requireUser(req) });
      } else if (req.method === 'GET' && path === '/api/rooms') {
        send(res, 200, { rooms: await accounts.roomsOf(requireUser(req).id) });
      } else if (req.method === 'GET' && path === '/api/github') {
        send(res, 200, await github.status(requireUser(req).id));
      } else if (req.method === 'POST' && path === '/api/github/token') {
        const user = requireUser(req);
        send(res, 200, await github.connect(user.id, (await readJson(req)).token));
      } else if (req.method === 'DELETE' && path === '/api/github/token') {
        await github.disconnect(requireUser(req).id);
        send(res, 200, { connected: false });
      } else {
        send(res, 404, { error: 'Not found.' });
      }
    } catch (err) {
      if (body && (err instanceof AuthError || err instanceof OtpError)) {
        // A failed login attempt: wrong password, wrong code, Google refused.
        if (path === '/api/auth/login') {
          await log({ event: 'login_failed', method: 'password', email: String(body.email || '').trim().toLowerCase() || null, reason: err.message });
        } else if (path === '/api/auth/google') {
          await log({ event: 'login_failed', method: 'google', reason: err.message });
        } else if (path === '/api/auth/verify') {
          const code = await accounts.codeInfo(body.id).catch(() => null);
          if (code && code.purpose !== 'phone') {
            await log({
              event: `${code.purpose}_failed`,
              method: `${code.channel} code`,
              userId: code.userId ?? null,
              [code.channel === 'sms' ? 'phone' : 'email']: code.target,
              reason: err.message,
            });
          }
        }
      }
      if (err instanceof GitHubError) {
        send(res, err.status === 401 ? 400 : err.status, { error: err.message });
      } else if (err instanceof OtpError) {
        send(res, err.status, { error: err.message, ...(err.retryIn ? { retryIn: err.retryIn } : {}) });
      } else if (err instanceof AuthError) {
        // A refresh that failed also clears the dead cookie.
        send(res, err.status, { error: err.message }, path === '/api/auth/refresh' && refreshToken ? accounts.clearCookie() : undefined);
      } else {
        console.error('[synq] account request failed:', err.message);
        send(res, 500, { error: 'Something went wrong. Try again.' });
      }
    }
    return true;
  };
}
