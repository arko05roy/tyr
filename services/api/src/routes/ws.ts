// PRD 5.4: live order/settlement events for the session's user.
import { bus, type PipelineEvent } from '@tyr/pipeline';
import type { FastifyPluginAsync } from 'fastify';
import { sessionUser } from './session.js';

export const wsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/ws', { websocket: true }, async (socket, req) => {
    const user = await sessionUser(req);
    if (!user) return socket.close(4401, 'unauthenticated');
    const forward = (e: PipelineEvent) => {
      if (e.userId === user.id) socket.send(JSON.stringify(e));
    };
    bus.on('event', forward);
    socket.on('close', () => bus.off('event', forward));
    socket.send(JSON.stringify({ type: 'hello', userId: user.id }));
  });
};
