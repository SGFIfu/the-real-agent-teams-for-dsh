export declare const agentTeamsDomain: {
    name: string;
    version: number;
    tables: {
        teams: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            id: string;
            name: string;
            goal: string;
            leadSessionId: string;
            workspaceId: string;
            status: "completed" | "failed" | "active" | "paused";
            createdAt: number;
            updatedAt: number;
        }>;
        members: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            id: string;
            teamId: string;
            sessionId: string;
            name: string;
            role: string;
            status: "working" | "blocked" | "reviewing" | "idle" | "failed" | "starting" | "stopped";
            joinedAt: number;
            lastActiveAt: number;
            currentTaskId?: string | undefined;
            provider?: string | undefined;
            model?: string | undefined;
            capabilities?: string[] | undefined;
        }>;
        tasks: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            id: string;
            teamId: string;
            title: string;
            description: string;
            status: "blocked" | "completed" | "failed" | "pending" | "in_progress" | "cancelled";
            priority: "critical" | "high" | "normal" | "low";
            dependencies: string[];
            requiresPlan: boolean;
            required: boolean;
            createdAt: number;
            ownerSessionId?: string | undefined;
            result?: string | undefined;
            startedAt?: number | undefined;
            completedAt?: number | undefined;
        }>;
        messages: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            id: string;
            teamId: string;
            fromSessionId: string;
            type: "message" | "plan" | "question" | "result" | "warning" | "handoff" | "review" | "shutdown";
            body: string;
            createdAt: number;
            toSessionId?: string | undefined;
            deliveryState?: "failed" | "pending" | "delivered" | undefined;
            deliveryTransport?: "native-followup" | "native-report" | "durable-inbox" | undefined;
            deliveredAt?: number | undefined;
            deliveryError?: string | undefined;
        }>;
        plans: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            id: string;
            teamId: string;
            taskId: string;
            authorSessionId: string;
            body: string;
            status: "approved" | "rejected" | "submitted";
            createdAt: number;
            feedback?: string | undefined;
            reviewedAt?: number | undefined;
        }>;
        file_claims: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            id: string;
            teamId: string;
            ownerSessionId: string;
            pattern: string;
            kind: "file" | "directory" | "glob";
            purpose: string;
            createdAt: number;
            ownerMemberId?: string | undefined;
        }>;
        findings: import("@deepseek-ai/dsh-storage-domain").DomainTableSpec<string, {
            id: string;
            teamId: string;
            authorSessionId: string;
            severity: "critical" | "high" | "low" | "medium";
            summary: string;
            detail: string;
            state: "open" | "resolved" | "accepted";
            createdAt: number;
            taskId?: string | undefined;
            title?: string | undefined;
            description?: string | undefined;
            evidence?: string | undefined;
            responsibleMemberId?: string | undefined;
            resolvedAt?: number | undefined;
        }>;
    };
};
