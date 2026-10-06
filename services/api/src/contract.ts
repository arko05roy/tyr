// PRD 11: contract enforcement. Requests are validated by zod (fastify-type-provider-zod);
// responses are validated in their JSON wire form against the route's response schema. A response
// that drifts from the contract is a 500 in dev/test ('strict') and a logged warning in production.
import type {
  FastifyError,
  FastifyInstance,
  FastifyPluginAsync,
  FastifyTypeProvider,
  RawServerDefault,
} from 'fastify';
import { hasZodFastifySchemaValidationErrors, validatorCompiler } from 'fastify-type-provider-zod';
import type { z } from 'zod';

/** Typed request validation; replies stay loosely typed (checked at runtime against the schema). */
export interface TyrTypeProvider extends FastifyTypeProvider {
  validator: this['schema'] extends z.ZodTypeAny ? z.output<this['schema']> : unknown;
  serializer: unknown;
}

export type ResponseCheck = 'strict' | 'warn';

const replacer = (_k: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v);

export function installContract(app: FastifyInstance, mode: ResponseCheck) {
  // Freeze guard: a route without a response schema is outside the contract — refuse to boot.
  app.addHook('onRoute', (r) => {
    const methods = [r.method].flat();
    if (r.websocket || methods.every((m) => m === 'HEAD')) return;
    if (!r.schema?.response)
      throw new Error(`${methods.join(',')} ${r.url} has no response schema (PRD 11 contract)`);
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(({ schema, method, url, httpStatus }) => {
    const zod = schema as z.ZodTypeAny;
    return (data) => {
      const wire: unknown = JSON.parse(JSON.stringify(data, replacer) ?? 'null');
      const r = zod.safeParse(wire);
      if (r.success) return JSON.stringify(r.data);
      const msg = `response ${method} ${url} ${httpStatus} violates contract: ${r.error.message}`;
      if (mode === 'strict') throw new Error(msg);
      app.log.warn(msg);
      return JSON.stringify(wire);
    };
  });
  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(err))
      return reply.code(400).send({
        error: err.message,
        code: 'validation',
        issues: err.validation.map((v) => ({
          path: v.instancePath || v.params.issue.path.join('.'),
          message: v.message ?? 'invalid',
        })),
      });
    const status = err.statusCode ?? 500;
    if (status >= 500) req.log.error(err);
    return reply.code(status).send({ error: err.message });
  });
}

/** A route plugin with zod-typed requests. */
export type TyrPlugin = FastifyPluginAsync<Record<never, never>, RawServerDefault, TyrTypeProvider>;
