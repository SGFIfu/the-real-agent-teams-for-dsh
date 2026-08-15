/**
 * Zod schemas for every durable record of the agent-teams storage domain.
 * The same schemas validate the harness storage domain at its durable
 * boundary (see `src/harness/domain.ts`).
 * @module dsh-agent-teams/core
 */
import { z } from 'zod';
export declare const sessionIdSchema: z.ZodString;
export declare const idSchema: z.ZodString;
export declare const teamSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    goal: z.ZodString;
    leadSessionId: z.ZodString;
    workspaceId: z.ZodString;
    status: z.ZodEnum<{
        completed: "completed";
        failed: "failed";
        active: "active";
        paused: "paused";
    }>;
    createdAt: z.ZodNumber;
    updatedAt: z.ZodNumber;
}, z.core.$strip>;
export declare const memberSchema: z.ZodObject<{
    id: z.ZodString;
    teamId: z.ZodString;
    sessionId: z.ZodString;
    name: z.ZodString;
    role: z.ZodString;
    status: z.ZodEnum<{
        working: "working";
        blocked: "blocked";
        reviewing: "reviewing";
        idle: "idle";
        failed: "failed";
        starting: "starting";
        stopped: "stopped";
    }>;
    currentTaskId: z.ZodOptional<z.ZodString>;
    provider: z.ZodOptional<z.ZodString>;
    model: z.ZodOptional<z.ZodString>;
    capabilities: z.ZodOptional<z.ZodArray<z.ZodString>>;
    joinedAt: z.ZodNumber;
    lastActiveAt: z.ZodNumber;
}, z.core.$strip>;
export declare const taskSchema: z.ZodObject<{
    id: z.ZodString;
    teamId: z.ZodString;
    title: z.ZodString;
    description: z.ZodString;
    status: z.ZodEnum<{
        blocked: "blocked";
        completed: "completed";
        failed: "failed";
        pending: "pending";
        in_progress: "in_progress";
        cancelled: "cancelled";
    }>;
    priority: z.ZodEnum<{
        critical: "critical";
        high: "high";
        normal: "normal";
        low: "low";
    }>;
    ownerSessionId: z.ZodOptional<z.ZodString>;
    dependencies: z.ZodArray<z.ZodString>;
    requiresPlan: z.ZodBoolean;
    required: z.ZodBoolean;
    result: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodNumber;
    startedAt: z.ZodOptional<z.ZodNumber>;
    completedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const messageSchema: z.ZodObject<{
    id: z.ZodString;
    teamId: z.ZodString;
    fromSessionId: z.ZodString;
    toSessionId: z.ZodOptional<z.ZodString>;
    type: z.ZodEnum<{
        message: "message";
        plan: "plan";
        question: "question";
        result: "result";
        warning: "warning";
        handoff: "handoff";
        review: "review";
        shutdown: "shutdown";
    }>;
    body: z.ZodString;
    createdAt: z.ZodNumber;
    deliveryState: z.ZodOptional<z.ZodEnum<{
        failed: "failed";
        pending: "pending";
        delivered: "delivered";
    }>>;
    deliveryTransport: z.ZodOptional<z.ZodEnum<{
        "native-followup": "native-followup";
        "native-report": "native-report";
        "durable-inbox": "durable-inbox";
    }>>;
    deliveredAt: z.ZodOptional<z.ZodNumber>;
    deliveryError: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const planSchema: z.ZodObject<{
    id: z.ZodString;
    teamId: z.ZodString;
    taskId: z.ZodString;
    authorSessionId: z.ZodString;
    body: z.ZodString;
    status: z.ZodEnum<{
        approved: "approved";
        rejected: "rejected";
        submitted: "submitted";
    }>;
    feedback: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodNumber;
    reviewedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const fileClaimSchema: z.ZodObject<{
    id: z.ZodString;
    teamId: z.ZodString;
    ownerSessionId: z.ZodString;
    ownerMemberId: z.ZodOptional<z.ZodString>;
    pattern: z.ZodString;
    kind: z.ZodEnum<{
        file: "file";
        directory: "directory";
        glob: "glob";
    }>;
    purpose: z.ZodString;
    createdAt: z.ZodNumber;
}, z.core.$strip>;
export declare const findingSchema: z.ZodObject<{
    id: z.ZodString;
    teamId: z.ZodString;
    authorSessionId: z.ZodString;
    taskId: z.ZodOptional<z.ZodString>;
    severity: z.ZodEnum<{
        critical: "critical";
        high: "high";
        low: "low";
        medium: "medium";
    }>;
    summary: z.ZodString;
    detail: z.ZodString;
    title: z.ZodOptional<z.ZodString>;
    description: z.ZodOptional<z.ZodString>;
    evidence: z.ZodOptional<z.ZodString>;
    responsibleMemberId: z.ZodOptional<z.ZodString>;
    state: z.ZodEnum<{
        open: "open";
        resolved: "resolved";
        accepted: "accepted";
    }>;
    createdAt: z.ZodNumber;
    resolvedAt: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const domainSchema: {
    readonly teams: z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        goal: z.ZodString;
        leadSessionId: z.ZodString;
        workspaceId: z.ZodString;
        status: z.ZodEnum<{
            completed: "completed";
            failed: "failed";
            active: "active";
            paused: "paused";
        }>;
        createdAt: z.ZodNumber;
        updatedAt: z.ZodNumber;
    }, z.core.$strip>;
    readonly members: z.ZodObject<{
        id: z.ZodString;
        teamId: z.ZodString;
        sessionId: z.ZodString;
        name: z.ZodString;
        role: z.ZodString;
        status: z.ZodEnum<{
            working: "working";
            blocked: "blocked";
            reviewing: "reviewing";
            idle: "idle";
            failed: "failed";
            starting: "starting";
            stopped: "stopped";
        }>;
        currentTaskId: z.ZodOptional<z.ZodString>;
        provider: z.ZodOptional<z.ZodString>;
        model: z.ZodOptional<z.ZodString>;
        capabilities: z.ZodOptional<z.ZodArray<z.ZodString>>;
        joinedAt: z.ZodNumber;
        lastActiveAt: z.ZodNumber;
    }, z.core.$strip>;
    readonly tasks: z.ZodObject<{
        id: z.ZodString;
        teamId: z.ZodString;
        title: z.ZodString;
        description: z.ZodString;
        status: z.ZodEnum<{
            blocked: "blocked";
            completed: "completed";
            failed: "failed";
            pending: "pending";
            in_progress: "in_progress";
            cancelled: "cancelled";
        }>;
        priority: z.ZodEnum<{
            critical: "critical";
            high: "high";
            normal: "normal";
            low: "low";
        }>;
        ownerSessionId: z.ZodOptional<z.ZodString>;
        dependencies: z.ZodArray<z.ZodString>;
        requiresPlan: z.ZodBoolean;
        required: z.ZodBoolean;
        result: z.ZodOptional<z.ZodString>;
        createdAt: z.ZodNumber;
        startedAt: z.ZodOptional<z.ZodNumber>;
        completedAt: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
    readonly messages: z.ZodObject<{
        id: z.ZodString;
        teamId: z.ZodString;
        fromSessionId: z.ZodString;
        toSessionId: z.ZodOptional<z.ZodString>;
        type: z.ZodEnum<{
            message: "message";
            plan: "plan";
            question: "question";
            result: "result";
            warning: "warning";
            handoff: "handoff";
            review: "review";
            shutdown: "shutdown";
        }>;
        body: z.ZodString;
        createdAt: z.ZodNumber;
        deliveryState: z.ZodOptional<z.ZodEnum<{
            failed: "failed";
            pending: "pending";
            delivered: "delivered";
        }>>;
        deliveryTransport: z.ZodOptional<z.ZodEnum<{
            "native-followup": "native-followup";
            "native-report": "native-report";
            "durable-inbox": "durable-inbox";
        }>>;
        deliveredAt: z.ZodOptional<z.ZodNumber>;
        deliveryError: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    readonly plans: z.ZodObject<{
        id: z.ZodString;
        teamId: z.ZodString;
        taskId: z.ZodString;
        authorSessionId: z.ZodString;
        body: z.ZodString;
        status: z.ZodEnum<{
            approved: "approved";
            rejected: "rejected";
            submitted: "submitted";
        }>;
        feedback: z.ZodOptional<z.ZodString>;
        createdAt: z.ZodNumber;
        reviewedAt: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
    readonly file_claims: z.ZodObject<{
        id: z.ZodString;
        teamId: z.ZodString;
        ownerSessionId: z.ZodString;
        ownerMemberId: z.ZodOptional<z.ZodString>;
        pattern: z.ZodString;
        kind: z.ZodEnum<{
            file: "file";
            directory: "directory";
            glob: "glob";
        }>;
        purpose: z.ZodString;
        createdAt: z.ZodNumber;
    }, z.core.$strip>;
    readonly findings: z.ZodObject<{
        id: z.ZodString;
        teamId: z.ZodString;
        authorSessionId: z.ZodString;
        taskId: z.ZodOptional<z.ZodString>;
        severity: z.ZodEnum<{
            critical: "critical";
            high: "high";
            low: "low";
            medium: "medium";
        }>;
        summary: z.ZodString;
        detail: z.ZodString;
        title: z.ZodOptional<z.ZodString>;
        description: z.ZodOptional<z.ZodString>;
        evidence: z.ZodOptional<z.ZodString>;
        responsibleMemberId: z.ZodOptional<z.ZodString>;
        state: z.ZodEnum<{
            open: "open";
            resolved: "resolved";
            accepted: "accepted";
        }>;
        createdAt: z.ZodNumber;
        resolvedAt: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
};
export type DomainTables = typeof domainSchema;
