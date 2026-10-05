import type { FastifyReply, FastifyRequest } from 'fastify';

export const SESSION_COOKIE = 'tyr_session';
const SESSION_TTL_MS = 7 * 86_400_000;

export async function startSession(req: FastifyRequest, reply: FastifyReply, userId: string) {
  const s = await req.server.db.session.create({
    data: { userId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });
  reply.setCookie(SESSION_COOKIE, s.id, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    signed: true,
    secure: process.env.NODE_ENV === 'production',
    expires: s.expiresAt,
  });
}

/** Resolve the logged-in user or send 401. */
export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const raw = req.cookies[SESSION_COOKIE];
  const unsigned = raw ? req.unsignCookie(raw) : null;
  if (!unsigned?.valid || !unsigned.value)
    return reply.code(401).send({ error: 'unauthenticated' });
  const s = await req.server.db.session.findUnique({
    where: { id: unsigned.value },
    include: { user: true },
  });
  if (!s || s.expiresAt < new Date()) return reply.code(401).send({ error: 'session expired' });
  return s.user;
}
