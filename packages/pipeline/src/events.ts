// PRD 5.4: in-process bus; /ws fans these out to the owning user's sockets.
import { EventEmitter } from 'node:events';

export type PipelineEvent =
  | { type: 'order'; userId: string; orderId: string; step: string; status: string }
  | { type: 'settlement'; userId: string; orderId: string; outcome: string; payoutUsd: number };

class Bus extends EventEmitter<{ event: [PipelineEvent] }> {}
export const bus = new Bus();
export const emit = (e: PipelineEvent) => bus.emit('event', e);
