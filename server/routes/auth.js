import { Router } from 'express';
import { getDb } from '../db/index.js';
import {
  clearSession, createAccountWithEmail, issueSession, maybeCreateUser,
  requireAuth, sendPasswordReset, signInWithEmail,
} from '../services/auth.js';

export const authRouter = Router();

/** Registrazione: createUserWithEmailAndPassword → maybeCreateUser → update(email, display_name, created_time, phone_number) */
authRouter.post('/auth/register', async (req, res) => {
  const { nome = '', email = '', telefono = '', password = '' } = req.body ?? {};
  const uid = await createAccountWithEmail(email.trim(), password);
  await maybeCreateUser(uid, { email: email.trim() });
  const db = await getDb();
  const user = await db.update(`Users/${uid}`, {
    email,
    display_name: nome,
    created_time: new Date(),
    phone_number: telefono,
  });
  issueSession(res, uid);
  res.status(201).json(user);
});

/** Login: signInWithEmailAndPassword → maybeCreateUser */
authRouter.post('/auth/login', async (req, res) => {
  const { email = '', password = '' } = req.body ?? {};
  const uid = await signInWithEmail(email.trim(), password);
  const user = await maybeCreateUser(uid, { email: email.trim() });
  issueSession(res, uid);
  res.json(user);
});

authRouter.post('/auth/reset', async (req, res) => {
  await sendPasswordReset(String(req.body?.email ?? '').trim());
  res.json({ ok: true });
});

authRouter.post('/auth/logout', (req, res) => {
  clearSession(res);
  res.json({ ok: true });
});

authRouter.get('/auth/me', requireAuth, (req, res) => res.json(req.user));

/** Dialog Account: aggiorna solo il documento Users (email, display_name, phone_number) come l'originale */
authRouter.patch('/account', requireAuth, async (req, res) => {
  const { nome = '', email = '', telefono = '' } = req.body ?? {};
  const db = await getDb();
  res.json(await db.update(req.user.ref, { email, display_name: nome, phone_number: telefono }));
});
