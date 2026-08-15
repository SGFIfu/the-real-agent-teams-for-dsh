/**
 * Typed error model. Every failure path returns one of these codes — never a
 * bare `Error('something went wrong')`.
 * @module dsh-agent-teams/core
 */
export class TeamError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = 'TeamError';
        this.code = code;
        this.details = details;
    }
    toJSON() {
        return { code: this.code, message: this.message, details: this.details };
    }
}
export function teamError(code, message, details) {
    return new TeamError(code, message, details);
}
/** True when the unknown value is one of our typed errors. */
export function isTeamError(value) {
    return value instanceof TeamError;
}
