# Security Considerations for AI Infrastructure

## Overview

This document outlines security best practices for the AI infrastructure, including credential management, network security, and access control.

## Threat Model

### Potential Threats

1. **Credential Theft**
   - Attacker gains access to AI provider API keys
   - Attacker uses credentials for unauthorized API calls

2. **Service Token Compromise**
   - Attacker gains access to bot server
   - Attacker uses service token to access Admin API

3. **Man-in-the-Middle Attacks**
   - Attacker intercepts credentials in transit
   - Attacker intercepts AI responses

4. **Unauthorized Access**
   - Attacker accesses Admin API without proper authentication
   - Attacker modifies provider configurations

## Security Measures

### 1. Credential Storage

**Admin API:**
- ✅ Store credentials encrypted at rest
- ✅ Use strong encryption (AES-256-GCM)
- ✅ Rotate encryption keys periodically
- ✅ Never log credentials
- ✅ Never return credentials in error messages

**Bot Server:**
- ✅ Cache credentials in memory only
- ✅ Short TTL (1 hour)
- ✅ Clear cache on errors
- ✅ Never persist credentials
- ✅ Never log credentials

### 2. Network Security

**All Communication:**
- ✅ HTTPS only (TLS 1.2+)
- ✅ Certificate pinning (optional)
- ✅ Internal network for Admin API ↔ Bot Server

**AI Provider Calls:**
- ✅ HTTPS for external providers
- ✅ Validate SSL certificates
- ✅ Timeout connections (30s default)

### 3. Service Token Security

**Token Scope:**
- ✅ Minimal permissions (read-only for configs)
- ✅ No admin functions
- ✅ No user data access
- ✅ Only AI-related endpoints

**Token Management:**
- ✅ Rotate tokens periodically
- ✅ Revoke compromised tokens immediately
- ✅ Monitor token usage
- ✅ Alert on suspicious activity

**Token Storage:**
- ✅ Environment variables (not in code)
- ✅ Secret management system (Vault, etc.)
- ✅ Never commit to git

### 4. Access Control

**Admin API:**
- ✅ Service token authentication
- ✅ Scope-based permissions
- ✅ Rate limiting
- ✅ Audit logging

**Bot Server:**
- ✅ Validate service token before Admin API calls
- ✅ Handle authentication errors gracefully
- ✅ Don't expose credentials in logs

### 5. Input Validation

**User Messages:**
- ✅ Sanitize before sending to AI
- ✅ Length limits (prevent DoS)
- ✅ Rate limit per bot/user

**AI Responses:**
- ✅ Validate response format
- ✅ Length limits
- ✅ Sanitize before displaying

## Implementation Details

### Credential Encryption

```typescript
// Admin API: Encrypt before storing
import crypto from 'crypto';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; // 32-byte key
const ALGORITHM = 'aes-256-gcm';

function encryptApiKey(apiKey: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    
    let encrypted = cipher.update(apiKey, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag();
    
    // Store: iv:authTag:encrypted
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decryptApiKey(encrypted: string): string {
    const [ivHex, authTagHex, encryptedData] = encrypted.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
}
```

### Service Token Validation

```typescript
// Admin API: Validate service token
async function validateServiceToken(token: string): Promise<boolean> {
    // 1. Verify token format
    if (!token.startsWith('bot-service-')) {
        return false;
    }
    
    // 2. Verify token signature (JWT or similar)
    const payload = await verifyJWT(token);
    if (!payload) {
        return false;
    }
    
    // 3. Check permissions
    if (!payload.permissions.includes('bots:ai-providers:read')) {
        return false;
    }
    
    // 4. Check expiration
    if (payload.exp < Date.now() / 1000) {
        return false;
    }
    
    return true;
}
```

### Secure Credential Fetching

```typescript
// Bot Server: Fetch credentials securely
private async fetchProviderCredentials(providerId: string): Promise<AIProviderConfig> {
    try {
        const response = await fetch(
            `${this.adminApiUrl}/api/bots/ai-providers/${providerId}/credentials`,
            {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.serviceToken}`,
                    'Content-Type': 'application/json',
                },
                // Security headers
                signal: AbortSignal.timeout(5000), // 5s timeout
            }
        );

        if (!response.ok) {
            // Don't expose error details
            throw new Error('Failed to fetch credentials');
        }

        const config = await response.json();
        
        // Validate response
        if (!config.providerId || !config.endpoint) {
            throw new Error('Invalid credential response');
        }
        
        // Never log credentials
        if (process.env.ENABLE_BOT_DEBUG === 'true') {
            console.log(`[AIService] Fetched credentials for ${providerId} (endpoint: ${config.endpoint})`);
            // Don't log apiKey!
        }
        
        return config;
    } catch (error) {
        // Clear cache on error
        this.credentialCache.delete(providerId);
        throw error;
    }
}
```

## Security Checklist

### Admin API

- [ ] Credentials encrypted at rest (AES-256-GCM)
- [ ] Service token authentication
- [ ] Scope-based permissions
- [ ] Rate limiting
- [ ] Audit logging
- [ ] Input validation
- [ ] HTTPS only
- [ ] No credentials in logs
- [ ] Token rotation support

### Bot Server

- [ ] Service token from environment
- [ ] Credentials cached in memory only
- [ ] Short cache TTL (1 hour)
- [ ] Clear cache on errors
- [ ] HTTPS for all API calls
- [ ] Timeout connections
- [ ] Input validation
- [ ] No credentials in logs
- [ ] Error handling (don't expose details)

### Network

- [ ] HTTPS for all communication
- [ ] Internal network for Admin API ↔ Bot Server
- [ ] Firewall rules
- [ ] Certificate validation
- [ ] No credentials in URLs

## Incident Response

### If Credentials Compromised

1. **Immediate Actions:**
   - Rotate API keys in provider
   - Revoke service token
   - Clear credential cache
   - Audit recent usage

2. **Investigation:**
   - Check audit logs
   - Identify breach vector
   - Assess damage

3. **Prevention:**
   - Update security measures
   - Review access controls
   - Improve monitoring

### If Service Token Compromised

1. **Immediate Actions:**
   - Revoke compromised token
   - Issue new token
   - Update bot server
   - Audit Admin API access

2. **Investigation:**
   - Check what was accessed
   - Identify breach vector
   - Assess damage

3. **Prevention:**
   - Rotate tokens more frequently
   - Improve token security
   - Add monitoring

## Monitoring and Alerts

### Metrics to Monitor

- Failed authentication attempts
- Unusual credential fetch patterns
- High API usage (potential abuse)
- Error rates
- Latency spikes

### Alerts

- Multiple failed auth attempts
- Credential fetch failures
- Unusual API usage patterns
- Service token usage from unexpected IPs

## Compliance

### Data Protection

- ✅ No user data in AI prompts (unless explicitly provided)
- ✅ Conversation history stored securely
- ✅ Usage tracking anonymized

### Audit Requirements

- ✅ Log all credential fetches
- ✅ Log all AI usage
- ✅ Log authentication attempts
- ✅ Retain logs for compliance period

