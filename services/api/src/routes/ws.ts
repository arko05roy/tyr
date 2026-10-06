// PRD 5.4: live order/settlement/deposit events for the session's user (schema: WsEvent).
import { bus, type PipelineEvent } from '@tyr/pipeline';
import type { TyrPlugin } from '../contract.js';
import { sessionUser } from './session.js';

export const wsRoutes: TyrPlugin = async (app) => {
  app.get(
    '/ws',
    {
      websocket: true,
      schema: {
        tags: ['events'],
        security: [{ session: [] }],
        description:
          'WebSocket upgrade. Pushes WsEvent JSON messages for the session user; closes 4401 ' +
          'when unauthenticated.',
      },
    },
    async (socket, req) => {
      const user = await sessionUser(req);
      if (!user) return socket.close(4401, 'unauthenticated');
      const forward = (e: PipelineEvent) => {
        if (e.userId === user.id) socket.send(JSON.stringify(e));
      };
      bus.on('event', forward);
      socket.on('close', () => bus.off('event', forward));
      socket.send(JSON.stringify({ type: 'hello', userId: user.id }));
    },
  );
};
