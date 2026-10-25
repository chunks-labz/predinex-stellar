# Compliance API Security

## Issue #1294: Access Control Fix

### Problem

The compliance API endpoints exposed sensitive data to anonymous callers:
- KYC tier
- Sanctions status (`isSanctioned`)
- Freeze status (`isFrozen`)
- Jurisdiction code
- KYC expiry
- Daily volume limits

This allowed enumeration of compliance status for any address without authentication.

### Solution

Implemented three-tier access control:

#### 1. Public Endpoints (No Auth)
- **GET /api/compliance/check/:address**
  - Returns only boolean `allowed/not-allowed`
  - Generic `reason` field if denied
  - Safe for anonymous callers

#### 2. Authenticated Endpoints
- **POST /api/compliance/verify**
  - Requires valid JWT token
  - Returns verification result
  - Limited error details for privacy

#### 3. Compliance Officer Only
- **GET /api/compliance/status/:address**
  - Requires `compliance_officer` or `admin` role
  - Returns full compliance record
  - All sensitive fields included

## Authentication Flow

### 1. Attach User Context
```typescript
complianceRouter.use(authMiddleware);
```
- Validates JWT if present
- Attaches `req.user` if valid
- Doesn't block if no token

### 2. Require Authentication
```typescript
complianceRouter.post('/verify', requireAuth, handler);
```
- Blocks if `req.user` is undefined
- Returns 401 Unauthorized

### 3. Require Role
```typescript
complianceRouter.get('/status/:address', requireComplianceOfficer, handler);
```
- Blocks if user role not in allowed list
- Returns 403 Forbidden

## API Endpoints

### Public: Check Compliance

```bash
# No authentication required
curl http://HOST/api/compliance/check/GABC...XYZ
```

**Response:**
```json
{
  "success": true,
  "data": {
    "participant": "GABC...XYZ",
    "allowed": true
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Denied Response:**
```json
{
  "success": true,
  "data": {
    "participant": "GABC...XYZ",
    "allowed": false,
    "reason": "Account frozen"
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Protected: Verify Operation

```bash
# Requires authentication
curl -H "Authorization: Bearer <token>" \
  -X POST http://HOST/api/compliance/verify \
  -H "Content-Type: application/json" \
  -d '{"participant":"GABC...XYZ","amount":10000}'
```

**Response:**
```json
{
  "success": true,
  "data": {
    "allowed": true
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Compliance Officer: Full Status

```bash
# Requires compliance_officer or admin role
curl -H "Authorization: Bearer <compliance-token>" \
  http://HOST/api/compliance/status/GABC...XYZ
```

**Response:**
```json
{
  "success": true,
  "data": {
    "participant": "GABC...XYZ",
    "tier": "Tier2_Accredited",
    "kycExpiry": 1736942400,
    "jurisdictionCode": 840,
    "isSanctioned": false,
    "isFrozen": false,
    "dailyVolumeLimitUsd": 250000
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## Error Responses

### 401 Unauthorized
```json
{
  "success": false,
  "error": "Authentication required"
}
```

### 403 Forbidden
```json
{
  "success": false,
  "error": "Insufficient permissions"
}
```

## Rate Limiting

All endpoints limited to 100 requests per 15 minutes per IP.

## Security Best Practices

### 1. JWT Token Management
- Store tokens securely (httpOnly cookies recommended)
- Rotate tokens regularly
- Use short expiration times (1 hour recommended)
- Validate tokens on every request

### 2. Role Assignment
- Compliance officer role should be strictly controlled
- Audit all role assignments
- Regular review of compliance officer list
- Separate admin and compliance officer roles

### 3. Logging
- Log all compliance status queries
- Log all freeze/unfreeze operations
- Include user identity in audit logs
- Monitor for suspicious patterns

### 4. Data Minimization
- Public endpoints return minimal data
- Error messages don't leak sensitive info
- Limit enumeration possibilities

## Migration from Insecure Version

If upgrading from version without access control:

1. **Audit existing callers** - identify who accesses `/status/:address`
2. **Issue tokens** - provide JWT tokens to legitimate callers
3. **Update clients** - add `Authorization` header
4. **Deploy with grace period** - temporarily allow both authenticated and unauthenticated access
5. **Remove fallback** - enforce authentication after migration period

## Testing

```bash
# Test public endpoint (should work)
curl http://localhost:3000/api/compliance/check/GABC...XYZ

# Test protected endpoint without auth (should fail with 401)
curl -X POST http://localhost:3000/api/compliance/verify \
  -H "Content-Type: application/json" \
  -d '{"participant":"GABC...XYZ"}'

# Test full status without auth (should fail with 401)
curl http://localhost:3000/api/compliance/status/GABC...XYZ

# Test with invalid role (should fail with 403)
curl -H "Authorization: Bearer <user-token>" \
  http://localhost:3000/api/compliance/status/GABC...XYZ

# Test with compliance officer role (should succeed)
curl -H "Authorization: Bearer <compliance-token>" \
  http://localhost:3000/api/compliance/status/GABC...XYZ
```

## Related Issues

- #1294: Original access control issue
- #1280: Per-request engine vs durable state

## Changelog

### v1.1.0 (Security Fix)
- Added `requireAuth` middleware
- Added `requireComplianceOfficer` middleware
- Created public `/check/:address` endpoint
- Protected `/verify` endpoint with auth
- Protected `/status/:address` with compliance officer role
- Added rate limiting
- Updated documentation
