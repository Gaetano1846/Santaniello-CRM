import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { config } from '../config.js';
import { getDb } from '../db/index.js';

const scrypt = promisify(scryptCb);

/* ---------------------------------------------------------------- sessione */

const COOKIE = 'crm_session';
const sign = (s) => createHmac('sha256', config.sessionSecret).update(s).digest('base64url');

export function issueSession(res, uid) {
  const exp = Date.now() + config.sessionDays * 864e5;
  const payload = Buffer.from(JSON.stringify({ uid, exp })).toString('base64url');
  res.cookie(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: config.sessionDays * 864e5,
  });
}

export function clearSession(res) {
  res.clearCookie(COOKIE);
}

function readSession(req) {
  const raw = req.cookies?.[COOKIE];
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  const expected = sign(payload ?? '');
  if (!sig || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return data.exp > Date.now() ? data : null;
}

/** Middleware: richiede login; espone req.user = { uid, ref, ...doc Users } */
export async function requireAuth(req, res, next) {
  const s = readSession(req);
  if (!s) return res.status(401).json({ error: 'Sessione scaduta, effettua di nuovo il login' });
  const db = await getDb();
  const user = await db.get(`Users/${s.uid}`);
  req.user = { uid: s.uid, ref: `Users/${s.uid}`, ...(user ?? {}) };
  next();
}

/* ------------------------------------------------------------ credenziali */

class AuthError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// Messaggi italiani per i codici di errore di Firebase Auth
const FIREBASE_ERRORS = {
  EMAIL_EXISTS: 'Esiste già un account con questa email',
  EMAIL_NOT_FOUND: 'Email o password non corretti',
  INVALID_PASSWORD: 'Email o password non corretti',
  INVALID_LOGIN_CREDENTIALS: 'Email o password non corretti',
  USER_DISABLED: 'Account disabilitato',
  INVALID_EMAIL: 'Email non valida',
  TOO_MANY_ATTEMPTS_TRY_LATER: 'Troppi tentativi, riprova più tardi',
};

async function identityToolkit(method, body) {
  if (!config.firebase.webApiKey) throw new AuthError('FIREBASE_WEB_API_KEY non configurata', 500);
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${config.firebase.webApiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) {
    const code = String(json.error?.message ?? '').split(' ')[0];
    throw new AuthError(FIREBASE_ERRORS[code] ?? (code.startsWith('WEAK_PASSWORD') ? 'La password deve avere almeno 6 caratteri' : 'Errore di autenticazione'));
  }
  return json;
}

async function hashPassword(password, salt = randomBytes(16).toString('hex')) {
  const key = await scrypt(password, salt, 64);
  return { salt, hash: key.toString('hex') };
}

/** Login email/password → uid */
export async function signInWithEmail(email, password) {
  const db = await getDb();
  if (db.kind === 'firestore') {
    const r = await identityToolkit('signInWithPassword', { email, password, returnSecureToken: true });
    return r.localId;
  }
  const [acc] = await db.query('_Auth', { where: [['email', '==', email.toLowerCase()]], limit: 1 });
  if (!acc) throw new AuthError('Email o password non corretti', 401);
  const { hash } = await hashPassword(password, acc.salt);
  if (!timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(acc.hash, 'hex'))) throw new AuthError('Email o password non corretti', 401);
  return acc.id;
}

/** Registrazione → uid (il documento Users viene creato dal chiamante, come maybeCreateUser) */
export async function createAccountWithEmail(email, password) {
  const db = await getDb();
  if (password.length < 6) throw new AuthError('La password deve avere almeno 6 caratteri');
  if (db.kind === 'firestore') {
    const r = await identityToolkit('signUp', { email, password, returnSecureToken: true });
    return r.localId;
  }
  const exists = await db.query('_Auth', { where: [['email', '==', email.toLowerCase()]], limit: 1 });
  if (exists.length) throw new AuthError('Esiste già un account con questa email');
  // Profilo importato (es. da Firebase) senza credenziali: l'account viene collegato a quel profilo
  const [profile] = (await db.query('Users', { where: [['email', '==', email]] }))
    .concat(await db.query('Users', { where: [['email', '==', email.toLowerCase()]] }));
  const uid = profile?.id ?? db.newId('_Auth');
  await db.set(`_Auth/${uid}`, { email: email.toLowerCase(), ...(await hashPassword(password)) });
  return uid;
}

export async function sendPasswordReset(email) {
  const db = await getDb();
  if (db.kind === 'firestore') await identityToolkit('sendOobCode', { requestType: 'PASSWORD_RESET', email });
  // in modalità demo non c'è invio email: la richiesta viene accettata silenziosamente
}

/**
 * Porting di maybeCreateUser() di FlutterFlow: crea Users/{uid} se non esiste
 * con i campi standard (email, display_name, photo_url, uid, created_time, phone_number).
 */
export async function maybeCreateUser(uid, { email, displayName = '', phoneNumber = '', photoUrl = '' }) {
  const db = await getDb();
  const existing = await db.get(`Users/${uid}`);
  if (existing) return existing;
  return db.set(`Users/${uid}`, {
    email,
    display_name: displayName,
    photo_url: photoUrl,
    uid,
    created_time: new Date(),
    phone_number: phoneNumber,
  });
}
