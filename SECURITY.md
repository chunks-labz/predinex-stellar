# Security Policy

## Supported Versions

This security policy applies to the following versions of Predinex Stellar:

| Version | Supported |
|---------|-----------|
| Current main branch | ✅ |
| Latest release | ✅ |
| Previous releases | ❌ |

## Reporting a Vulnerability

If you discover a security vulnerability in Predinex Stellar, please report it responsibly. We take security seriously and appreciate your help in keeping our users and their funds safe.

### How to Report

**Please do NOT report security vulnerabilities through public GitHub issues.**

Instead, please send your report to:

- **Email**: `security@predinex.io`
- **PGP Key**: See below for encrypted communication

### PGP Key for Encrypted Communication

For sensitive vulnerability reports, we strongly recommend encrypting your communication using PGP.

```
-----BEGIN PGP PUBLIC KEY BLOCK-----

[PGP PUBLIC KEY TO BE ADDED]

-----END PGP PUBLIC KEY BLOCK-----
```

**Fingerprint**: `[FINGERPRINT TO BE ADDED]`

To verify this key, please check the official Predinex website or contact us through an alternative verified channel.

### What to Include in Your Report

Please include the following information in your vulnerability report:

1. **Description**: A clear description of the vulnerability
2. **Impact**: Potential impact on users and funds
3. **Steps to Reproduce**: Detailed steps to reproduce the issue
4. **Proof of Concept**: If applicable, a proof of concept or code snippet
5. **Affected Versions**: Which versions are affected
6. **Suggested Fix**: If you have a suggested fix, please include it

## Scope

This security policy covers:

### In Scope
- **Smart Contracts**: The `predinex` Soroban smart contract (`contracts/predinex/`)
- **Contract Interfaces**: All public functions and entry points
- **Token Integration**: Stellar Asset Contract (SAC) integration
- **Access Control**: Authorization mechanisms and permission checks
- **Fund Management**: Pool creation, betting logic, and settlement mechanisms
- **Web Application**: The frontend application at `web/` (authentication, input validation, API security)

### Out of Scope
- Third-party dependencies (unless directly exploitable in our context)
- Issues requiring physical access to user devices
- Social engineering attacks
- Issues in Stellar network itself or other blockchain infrastructure
- Already known public vulnerabilities

## Disclosure Timeline

We follow a coordinated disclosure process to protect users while giving credit to researchers:

| Phase | Duration | Description |
|-------|----------|-------------|
| **Initial Response** | Within 48 hours | We acknowledge receipt of your report |
| **Triage & Assessment** | Within 7 days | We assess severity and confirm the vulnerability |
| **Fix Development** | 30-90 days | We develop and test a fix depending on severity |
| **Deployment** | Within 14 days after fix | We deploy the fix to testnet/mainnet |
| **Public Disclosure** | After fix deployment | We publish the disclosure and credit the reporter |

### Severity Levels

- **Critical**: Immediate risk of fund loss or contract compromise (target fix: 30 days)
- **High**: Significant security impact but no immediate fund loss (target fix: 60 days)
- **Medium**: Moderate security impact (target fix: 90 days)
- **Low**: Minor security issues (target fix: next release)

## Recognition Policy

We value the work of security researchers and aim to recognize valid vulnerability reports:

### For Valid Reports
- **Credit**: Public acknowledgment in our security advisories (with your permission)
- **Hall of Fame**: Inclusion in our security hall of fame (if desired)
- **Swag**: Predinex merchandise (subject to availability)
- **Bounty**: For critical vulnerabilities, we may offer a bounty (contact us for details)

### Bounty Program

We are working on establishing a formal bug bounty program. For now, bounties are handled on a case-by-case basis for critical vulnerabilities that could result in fund loss. Contact us at `security@predinex.io` for more information.

## Emergency Contact

For **critical** vulnerabilities that are actively being exploited or pose an immediate threat to user funds:

- **Email**: `emergency@predinex.io`
- **Response Time**: Within 12 hours
- **PGP Key**: Same as above

## Safe Harbor

We commit to:

- **No Legal Action**: We will not pursue legal action against security researchers who follow this policy
- **Response**: We will respond to all vulnerability reports within the timelines specified
- **Credit**: We will credit researchers who discover vulnerabilities (with permission)
- **Protection**: We will work with researchers to ensure responsible disclosure

## Verifying Signed Commits

To verify the authenticity of our releases and commits, we use GPG signing:

### Verifying a Tag

```bash
git fetch --tags
git tag -v <tag-name>
```

### Verifying a Commit

```bash
git log --show-signature
```

Our commit signing key:

```
-----BEGIN PGP PUBLIC KEY BLOCK-----

[COMMIT SIGNING KEY TO BE ADDED]

-----END PGP PUBLIC KEY BLOCK-----
```

**Fingerprint**: `[COMMIT SIGNING FINGERPRINT TO BE ADDED]`

## Security Best Practices for Users

While we work hard to secure the protocol, users should also follow best practices:

1. **Only use official contract addresses** from our documentation
2. **Verify contract bytecode** before interacting (see our verification guide)
3. **Never share your private keys** or seed phrases
4. **Use hardware wallets** for significant amounts
5. **Keep your software updated** to the latest version
6. **Be cautious of phishing attempts** - always verify URLs

## Security Audits

This project has undergone/is undergoing security audits by reputable firms. Audit reports will be published here:

- [Audit Report 1 - Coming Soon]
- [Audit Report 2 - Coming Soon]

## Reaching Out

If you have questions about this security policy or need clarification:

- **General Security Questions**: `security@predinex.io`
- **Press/Media**: `press@predinex.io`
- **General Inquiries**: `hello@predinex.io`

---

Thank you for helping keep Predinex Stellar secure! 🛡️
