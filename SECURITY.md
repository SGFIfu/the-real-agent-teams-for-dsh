# Security Model

## Overview

The Agent Teams Command Center provides a web interface for controlling agent teams. This document describes the security architecture and best practices for deploying the service.

## Authentication Mechanisms

The command route implements **defense-in-depth** with two authentication layers:

### 1. Principal-Based Authentication (Recommended)

When the `authorizeCaller` hook is provided, the route enforces **principal-based authentication** with team ownership verification.

**Security Properties:**
- ✅ Multi-user identity verification
- ✅ Team ownership verification  
- ✅ Fine-grained access control per mutation type
- ✅ Audit logging with principal identity

**Required for:**
- Production deployments
- Shared development environments
- Multi-user access scenarios
- Cloud workspaces / containers

**Implementation:**

```typescript
import { commandRoute, type CommandCaller } from 'dsh-agent-teams/harness';

const route = commandRoute(service, {
  interrupt: (team, sessionId) => {
    // Your interrupt implementation
  },
  authorizeCaller: async (req, context) => {
    // Extract principal identity from trusted source
    const token = extractJWT(req.headers.authorization);
    const claims = await verifyJWT(token);
    
    // Return undefined for unauthenticated requests
    if (!claims) {
      return undefined;
    }
    
    // Lookup team access for this principal
    const teamAccess = await getTeamAccessForPrincipal(claims.sub);
    
    return {
      principalId: claims.sub,
      teamIds: teamAccess, // ['team_a', 'team_b']
    };
  },
});
```

**Access Control Semantics:**
- `teamIds` undefined: Principal can access ANY team (admin/super-user)
- `teamIds` defined: Principal can ONLY access teams in the allowlist

### 2. Browser Capability Fallback (Development Only)

When `authorizeCaller` is **not** provided, the route falls back to a browser capability model.

**Security Properties:**
- ✅ Loopback-only access (127.0.0.1)
- ✅ CSRF token verification
- ✅ Same-origin policy enforcement
- ✅ One team per browser session

**Limitations:**
- ❌ NO multi-user identity verification
- ❌ NO protection against local processes
- ❌ Insufficient for shared environments

**Suitable ONLY for:**
- Single-user localhost development
- Scenarios where loopback isolation is sufficient

## Loopback Limitation

**CRITICAL**: Loopback-only access is NOT sufficient for multi-user security.

In shared environments, multiple users can access 127.0.0.1:
- Container environments
- Remote development workspaces (GitHub Codespaces, Cloud9, etc.)
- Multi-user development machines
- Shared SSH servers

Any process running under ANY user account on the same machine can make loopback requests. This means:
- User Alice can control User Bob's teams
- Malicious local processes can hijack teams
- No audit trail of WHO performed actions

**Solution**: Always use `authorizeCaller` in shared environments.

## Security Checklist

### Production Deployment

- [ ] `authorizeCaller` hook is implemented
- [ ] Principal identity extracted from trusted source (JWT, mTLS, session service)
- [ ] Team access allowlist is enforced
- [ ] Authorization decisions are logged for audit
- [ ] Tokens/sessions are validated on every request
- [ ] Token rotation/expiration is implemented
- [ ] HTTPS is enforced (terminate TLS before loopback if needed)

### Development Environment

- [ ] If shared environment: implement `authorizeCaller`
- [ ] If single-user localhost: fallback is acceptable
- [ ] Document security assumptions in deployment docs
- [ ] Never expose port publicly without authentication

## Authorization Hook Implementation Guide

### JWT-Based Authentication

```typescript
import jwt from 'jsonwebtoken';

authorizeCaller: async (req, context) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return undefined;
  }
  
  try {
    const token = authHeader.slice(7);
    const claims = jwt.verify(token, process.env.JWT_SECRET);
    
    return {
      principalId: claims.sub,
      teamIds: claims.teams, // From JWT claims
    };
  } catch (error) {
    console.error('JWT verification failed:', error);
    return undefined;
  }
}
```

### Session-Based Authentication

```typescript
authorizeCaller: async (req, context) => {
  const sessionId = extractSessionCookie(req.headers.cookie);
  if (!sessionId) {
    return undefined;
  }
  
  try {
    const principal = await principalService.validateSession(sessionId);
    if (!principal) {
      return undefined;
    }
    
    const teams = await principalService.getTeamAccess(principal.id);
    
    return {
      principalId: principal.id,
      teamIds: teams.map(t => t.id),
    };
  } catch (error) {
    console.error('Session validation failed:', error);
    throw error; // Rethrown as 401
  }
}
```

### mTLS Client Certificate

```typescript
import { TLSSocket } from 'tls';

authorizeCaller: async (req, context) => {
  const socket = req.socket as TLSSocket;
  const cert = socket.getPeerCertificate();
  
  if (!cert || !cert.subject) {
    return undefined;
  }
  
  const principalId = cert.subject.CN; // Common Name
  const teams = await lookupTeamAccessByCertificate(cert);
  
  return {
    principalId,
    teamIds: teams,
  };
}
```

## Audit Logging

The command route automatically logs all authorization decisions:

```typescript
// Successful authorization
[command-route] Authorization granted {
  principalId: 'user123',
  teamId: 'team_a',
  mutation: 'message',
  teamRestricted: true
}

// Rejected - no principal
[command-route] Authorization rejected: no principal identity {
  teamId: 'team_a',
  mutation: 'message',
  browserSessionId: 'abc123'
}

// Rejected - not in allowlist
[command-route] Authorization rejected: principal not in team allowlist {
  principalId: 'user456',
  requestedTeamId: 'team_b',
  allowedTeamIds: ['team_a'],
  mutation: 'pause'
}
```

Capture these logs for security monitoring and incident response.

## Threat Model

### Threats Mitigated

| Threat | Mitigation |
|--------|-----------|
| Remote network attacks | Loopback-only binding |
| CSRF attacks | CSRF token verification + same-origin |
| Cross-team access | Team ownership verification |
| Session replay | Cryptographically secure session tokens |
| Unauthorized mutations | Principal authentication + team allowlist |

### Threats NOT Mitigated (Without authorizeCaller)

| Threat | Why Not Mitigated |
|--------|------------------|
| Malicious local process | Can access 127.0.0.1 |
| Multi-user shared machine | All users can access loopback |
| Privilege escalation | No principal identity verification |
| Audit evasion | No user attribution in logs |

## Migration Path

If you're currently using the fallback mechanism and need to upgrade:

1. **Inventory your deployment**: Is this single-user or shared?
2. **Choose auth mechanism**: JWT, session service, or mTLS
3. **Implement authorizeCaller**: Start with basic principal identity
4. **Add team allowlist**: Query your team access control system
5. **Test authorization**: Verify both allowed and denied access
6. **Deploy with monitoring**: Watch authorization logs
7. **Rotate browser sessions**: Force re-authentication

## Security Contact

For security vulnerabilities, please follow responsible disclosure:
- Do NOT open public GitHub issues
- Contact: [your security contact email]
- PGP key: [if applicable]

## References

- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html)
- [OWASP Authorization Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
- [JWT Best Practices](https://datatracker.ietf.org/doc/html/rfc8725)
