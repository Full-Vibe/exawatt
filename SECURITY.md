# Security Policy

**TL;DR: Report vulnerabilities privately through GitHub Security Advisories; never open a public vulnerability issue.**

## Supported code

Before the first stable public release, security fixes target current
`master`. After tagged releases begin, the latest stable release and current
`master` receive security fixes. Older versions may be affected even when a
patch cannot be backported.

Community builds and official Exawatt distributions have different service
configuration, signing, and update boundaries. Please identify which one you
tested and include the exact commit or version.

## Report a vulnerability

Use [GitHub's private vulnerability reporting form](https://github.com/Full-Vibe/exawatt/security/advisories/new).
If that form is unavailable, email the existing public legal contact at
[legal@exawatt.ai](mailto:legal@exawatt.ai) with the subject
`[Exawatt security]`.

Do not include exploit details, credentials, personal data, or an
uncoordinated proof of concept in a public issue, pull request, Discussion,
chat, or social post.

Include, when possible:

- the affected version or commit and whether the build is official,
  community, or distributor-configured;
- the affected component and Agent Source;
- reproduction steps and the security impact;
- a minimal proof of concept with secrets and personal data removed;
- relevant logs, crash reports, or screenshots after redaction;
- any known mitigations or disclosure deadline.

## What to expect

Maintainers will acknowledge a complete report as capacity allows, validate
the impact, coordinate a fix and release when warranted, and credit the
reporter unless anonymity is requested. Please allow time for investigation
before public disclosure. This project does not currently promise a response
SLA or bug bounty.

Good-faith testing should minimize access and harm: use accounts and data you
control, stop after demonstrating impact, do not persist access, do not degrade
service, and delete data obtained during testing.

General hardening suggestions and dependency-update reports that do not expose
a vulnerability may use a public issue. Questions and product support belong
in [`SUPPORT.md`](SUPPORT.md).
