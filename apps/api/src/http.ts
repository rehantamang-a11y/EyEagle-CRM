import type { PoolClient } from "pg";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

export const uuidParam = z.object({ id: z.string().uuid() });

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Opaque cursor: the created_at of the last row from the previous page. */
  cursor: z.string().datetime().optional(),
});

export function fail(reply: FastifyReply, status: number, code: string, message: string, extra: object = {}) {
  return reply.code(status).send({ error: { code, message, ...extra } });
}

/**
 * Every table carries a `version` column that was incremented on write but never
 * checked, so concurrent edits silently last-write-wins. Callers that pass
 * expectedVersion now get a 409 instead.
 */
export function versionMismatch(expected: number | undefined, actual: number): boolean {
  return expected !== undefined && expected !== actual;
}

export async function recordAudit(
  client: PoolClient,
  input: {
    actorUserId: string | null;
    action: string;
    entityType: string;
    /** entity_id is a uuid column; pass null for events with no natural uuid entity (e.g. an external sync run). */
    entityId: string | null;
    metadata?: Record<string, unknown>;
    requestId?: string;
  },
): Promise<void> {
  await client.query(
    `insert into audit_events (actor_user_id, action, entity_type, entity_id, metadata, request_id)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      input.actorUserId,
      input.action,
      input.entityType,
      input.entityId,
      JSON.stringify(input.metadata ?? {}),
      input.requestId ?? null,
    ],
  );
}

export const requestId = (request: FastifyRequest): string => String(request.id);

/**
 * Transaction bodies return either a failure discriminant or a payload. A guard
 * keeps the discriminant a plain string so error tables can be looked up directly.
 */
export function hasCode<T extends object>(value: T): value is T & { code: string } {
  return "code" in value;
}

export function failFromTable(
  reply: FastifyReply,
  code: string,
  table: Record<string, [number, string]>,
  extra: object = {},
) {
  const entry = table[code] ?? [500, "The request could not be completed."];
  return fail(reply, entry[0], code, entry[1], extra);
}
