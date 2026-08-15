/**
 * Zod schemas for every durable record of the agent-teams storage domain.
 * The same schemas validate the harness storage domain at its durable
 * boundary (see `src/harness/domain.ts`).
 * @module dsh-agent-teams/core
 */
import { z } from 'zod';
export const sessionIdSchema = z.string().min(1);
export const idSchema = z.string().min(1);
export const teamSchema = z.object({
    id: idSchema,
    name: z.string().min(1).max(120),
    goal: z.string().min(1).max(4000),
    leadSessionId: sessionIdSchema,
    workspaceId: z.string(),
    status: z.enum(['active', 'paused', 'completed', 'failed']),
    createdAt: z.number(),
    updatedAt: z.number(),
});
export const memberSchema = z.object({
    id: idSchema,
    teamId: idSchema,
    sessionId: sessionIdSchema,
    name: z.string().min(1).max(80),
    role: z.string().min(1).max(80),
    status: z.enum(['starting', 'working', 'idle', 'blocked', 'reviewing', 'stopped', 'failed']),
    currentTaskId: idSchema.optional(),
    provider: z.string().optional(),
    model: z.string().optional(),
    capabilities: z.array(z.string()).optional(),
    joinedAt: z.number(),
    lastActiveAt: z.number(),
});
export const taskSchema = z.object({
    id: idSchema,
    teamId: idSchema,
    title: z.string().min(1).max(200),
    description: z.string().max(8000),
    status: z.enum(['pending', 'in_progress', 'blocked', 'completed', 'failed', 'cancelled']),
    priority: z.enum(['critical', 'high', 'normal', 'low']),
    ownerSessionId: sessionIdSchema.optional(),
    dependencies: z.array(idSchema),
    requiresPlan: z.boolean(),
    required: z.boolean(),
    result: z.string().max(12000).optional(),
    createdAt: z.number(),
    startedAt: z.number().optional(),
    completedAt: z.number().optional(),
});
export const messageSchema = z.object({
    id: idSchema,
    teamId: idSchema,
    fromSessionId: sessionIdSchema,
    toSessionId: sessionIdSchema.optional(),
    type: z.enum(['message', 'question', 'result', 'warning', 'handoff', 'review', 'plan', 'shutdown']),
    body: z.string().min(1).max(16000),
    createdAt: z.number(),
    deliveryState: z.enum(['pending', 'delivered', 'failed']).optional(),
    deliveryTransport: z.enum(['native-followup', 'native-report', 'durable-inbox']).optional(),
    deliveredAt: z.number().optional(),
    deliveryError: z.string().max(4000).optional(),
});
export const planSchema = z.object({
    id: idSchema,
    teamId: idSchema,
    taskId: idSchema,
    authorSessionId: sessionIdSchema,
    body: z.string().min(1).max(30000),
    status: z.enum(['submitted', 'approved', 'rejected']),
    feedback: z.string().max(8000).optional(),
    createdAt: z.number(),
    reviewedAt: z.number().optional(),
});
export const fileClaimSchema = z.object({
    id: idSchema,
    teamId: idSchema,
    ownerSessionId: sessionIdSchema,
    ownerMemberId: idSchema.optional(),
    pattern: z.string().min(1).max(500),
    kind: z.enum(['file', 'directory', 'glob']),
    purpose: z.string().max(500),
    createdAt: z.number(),
});
export const findingSchema = z.object({
    id: idSchema,
    teamId: idSchema,
    authorSessionId: sessionIdSchema,
    taskId: idSchema.optional(),
    severity: z.enum(['critical', 'high', 'medium', 'low']),
    summary: z.string().min(1).max(300),
    detail: z.string().max(8000),
    title: z.string().max(300).optional(),
    description: z.string().max(8000).optional(),
    evidence: z.string().max(12000).optional(),
    responsibleMemberId: idSchema.optional(),
    state: z.enum(['open', 'resolved', 'accepted']),
    createdAt: z.number(),
    resolvedAt: z.number().optional(),
});
export const domainSchema = {
    teams: teamSchema,
    members: memberSchema,
    tasks: taskSchema,
    messages: messageSchema,
    plans: planSchema,
    file_claims: fileClaimSchema,
    findings: findingSchema,
};
