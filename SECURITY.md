# Security Policy

## Supported Versions

This security policy applies to the following versions of Predinex Stellar:

| Version | Supported |
|---------|-----------|
| Current main branch | ✅ |
| Latest release | ✅ |
| Previous releases | ❌ |

## Reporting a Vulnerability

If you discover a security vulnerability in Predinex Stellar, please report it
privately. We take security seriously and appreciate your help in keeping our
users and their funds safe.

**Please do NOT report security vulnerabilities through public GitHub issues,
pull requests or discussions.** A public report usually means the vulnerability
is public before a fix exists.

### Primary channel: GitHub Security Advisories

Report privately through GitHub's private advisory form for this repository:

**https://github.com/chunks-labz/predinex-stellar/security/advisories/new**

A security advisory is only visible to the maintainers and the reporter, so the
technical details stay private until a fix is deployed. It also gives both
sides a written record of the disclosure timeline.

> **Maintainers:** private vulnerability reporting has to be enabled once for
> this repository before outside reporters can use the form above:
>
> 1. Open **Settings → Code security → Private vulnerability reporting**.
> 2. Enable **Private vulnerability reporting**.
> 3. Confirm it is on:
>    ```bash
>    gh api repos/chunks-labz/predinex-stellar/private-vulnerability-reporting
>    # {"enabled":true}
>    ```
>
> Until that setting is on, the form above is not reachable for outside
> reporters and the secondary channel below applies.

### Secondary channel: project Discord

If the advisory form is not available to you, contact the maintainers through
the project Discord (**https://discord.gg/predinex**) and ask for a private
channel. Do not post vulnerability details in a public Discord channel.

> The reporting addresses that used to be listed in this file are **not**
> monitored any more: the project domain no longer resolves, so mail sent
> there bounces with a DNS error. Please do not use them.

### What to Include in Your Report

1. **Description**: A clear description of the vulnerability
2. **Impact**: Potential impact on users and funds
3. **Steps to Reproduce**: Detailed steps to reproduce the issue
4. **Proof of Concept**: If applicable, a proof of concept or code snippet
5. **Affected Versions**: Which versions are affected (commit, release or contract ID)
6. **Suggested Fix**: If you have a suggested fix, please include it

Please keep the report private until a fix has been deployed.

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

We follow a coordinated disclosure process to protect users while giving credit
to researchers:

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

For a vulnerability that is being actively exploited, open the advisory and mark
it as urgent so it can be triaged ahead of the schedule above.

## Safe Harbor

We commit to:

- **No Legal Action**: We will not pursue legal action against security researchers who follow this policy
- **Response**: We will respond to all vulnerability reports within the timelines specified
- **Credit**: We will credit researchers who discover vulnerabilities (with permission)
- **Protection**: We will work with researchers to ensure responsible disclosure

## Recognition Policy

We value the work of security researchers and aim to recognize valid vulnerability
reports:

- **Credit**: Public acknowledgment in our security advisories (with your permission)
- **Hall of Fame**: Inclusion in our security hall of fame (if desired)

There is no formal bounty program at the moment; critical reports are handled
case by case through the advisory channel above.

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

## Security Audits

No third-party audit report has been published for this repository yet. Treat
the code as unaudited and report anything that looks wrong through the channel
above.

## Security Best Practices for Users

While we work hard to secure the protocol, users should also follow best
practices:

1. **Only use official contract addresses** from our documentation
2. **Verify contract bytecode** before interacting (see our verification guide)
3. **Never share your private keys** or seed phrases
4. **Use hardware wallets** for significant amounts
5. **Keep your software updated** to the latest version
6. **Be cautious of phishing attempts** - always verify URLs

---

Thank you for helping keep Predinex Stellar secure!
