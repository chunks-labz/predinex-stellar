# API Authentication

This guide explains how to authenticate with the public API: where keys come from, how to send them, what roles they grant, how expiry works, and what the common authentication errors mean.

## Summary

- The API uses static API keys sent in the `x-api-key` header.
- There is no token-exchange endpoint. Operators provision keys through environment variables.
- Keys do not expire in the API code. Rotate them by changing the configuration and restarting.
- Keys in a query string are rejected. Send them only in the header.

## 1. Get a key

The API does not issue keys to callers. An operator adds a key to the API configuration:

| Variable | Grants | Format |
|---|---|---|
| `ADMIN_API_KEYS` | `Admin` | Comma-separated keys |
| `OFFICER_API_KEYS` | `ComplianceOfficer` | Comma-separated keys |
| `ASSESSOR_API_KEYS` | `Assessor` | Comma-separated keys |
| `USER_API_KEYS` | `User`, bound to one Stellar account | `apiKey=G...` entries, comma-separated |

Ask the operator of the deployment you use for a key. Keep keys out of source control, screenshots and shared logs.

Every key needs a non-empty value. A `USER_API_KEYS` entry that is not in `apiKey=ADDRESS` form, or whose address is not a valid Stellar account, stops the API from starting.

## 2. Send the key

Put the key in the `x-api-key` header on every request:

```bash
curl -H "x-api-key: YOUR_API_KEY" \
  https://api.example.com/api/markets
```

Replace `YOUR_API_KEY` with the key the operator gave you, and replace the host with the API you use. Do not put the key in the URL. The API ignores `?api_key=` and similar query parameters, so a request that depends on one will look unauthenticated.

## 3. Roles

| Role | How it is assigned | Typical use |
|---|---|---|
| `User` | A key in `USER_API_KEYS`, or no key at all | Market reads and user actions |
| `Assessor` | `ASSESSOR_API_KEYS` | Reviewing assessments |
| `ComplianceOfficer` | `OFFICER_API_KEYS` | Compliance endpoints |
| `Admin` | `ADMIN_API_KEYS` | Administrative and emergency endpoints |

A request without a key is treated as `User`. Routes that require a higher role reject it. A request with an unknown key is also treated as `User`, not rejected, so a wrong key on a public route looks the same as no key.

## 4. Expiry and rotation

- API keys have no expiry field and the API does not check their age.
- To rotate a key, add the new key to the configuration, update your client, then remove the old key and restart the API.
- A key cannot be registered twice. Adding a key already used for another role or account fails at startup with `API key is already registered`.

If your deployment expires keys by policy, the policy is enforced by the operator, not by the API.

## 5. Signed payloads

Some integrations sign request bodies with HMAC-SHA256 using the server's `AUTH_SECRET`. The API header is `sha256=<hex digest>`. The secret is a server-side value and is not given to API clients. If you need signed payloads, ask the operator how the signing secret is shared with your integration.

The API refuses to start if `AUTH_SECRET` is missing, blank, or set to a publicly known value.

## 6. Common authentication errors

| Status | Code | Cause | Fix |
|---|---|---|---|
| `401` | `UNAUTHORIZED` | The route needs a role your key does not have, or you sent no key to a route that needs one | Check the route's required role and use a key with that role |
| `429` | `RATE_LIMITED` | Too many requests in the window | Wait for `Retry-After` and retry. See [API Rate Limits](./RATE_LIMITS.md) |
| — | Startup failure: `AUTH_SECRET is not set` | The operator did not configure the signing secret | Operator sets `AUTH_SECRET` (for example `openssl rand -hex 32`) |
| — | Startup failure: `USER_API_KEYS entries must use the format apiKey=STELLAR_ADDRESS` | A malformed entry in the operator's configuration | Operator fixes the entry |
| — | Startup failure: `API key is already registered` | The same key is listed twice | Operator removes the duplicate |

A `401` is about authorization. It does not mean your key is invalid, because an unknown key is treated as `User`.

## Related

- [API Rate Limits](./RATE_LIMITS.md)
- [Environment Variables and Secrets](./ENVIRONMENT_VARIABLES.md)
