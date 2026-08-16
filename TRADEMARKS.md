# Exawatt Trademark and Distribution Policy

**TL;DR: You may discuss and modify Exawatt source, but only Full Vibe AI distributions are official; other binaries must use their own complete identity.**

The Exawatt name, Exawatt logos and icons, the "Official Exawatt" designation,
and any future "Exawatt Ready" conformance mark are trademarks or brand
features of Full Vibe AI (the "Exawatt Marks"). Open-source licenses govern
the code and specifications; they do not grant a trademark license.

This policy is adapted from the open-source project and software-distribution
patterns in the [Mozilla Trademark Guidelines](https://www.mozilla.org/en-US/foundation/trademarks/policy/),
[Mozilla Distribution Policy](https://www.mozilla.org/en-US/foundation/trademarks/distribution-policy/),
and [Element Trademark Policy](https://element.io/en/legal/trademark-policy).

## Uses that do not require permission

You may:

- use the word Exawatt in text to truthfully refer or link to this source
  project, its documentation, or an unmodified official distribution;
- accurately say that your software is based on Exawatt source or is compatible
  with a published Exawatt specification, provided your own name is more
  prominent and you state that Full Vibe AI does not publish, sponsor, or
  endorse it;
- use the word Exawatt in issue, pull-request, educational, news, review,
  criticism, and community discussion that does not imply endorsement;
- retain copyright, license, provenance, and historical references in source
  code; and
- retain the GitHub-generated relationship and source history in a repository
  fork.

These permissions do not include an Exawatt logo, icon, confusingly similar
mark, domain, product name, service name, social handle, or commercial
offering.

## Official distributions

An official Exawatt distribution is a binary published by Full Vibe AI through
an official release channel and carrying its expected signing identity. A
source checkout, fork, self-compiled binary, or downstream package is not
official even when its code is unmodified.

You may redistribute an exact, current official binary without separate
permission only when it is unmodified, provided without charge, preserves its
signature and notices, collects no information as part of the redistribution,
does not alter installation or updates, and clearly identifies you as the
redistributor rather than its publisher. Linking to the official download is
preferred. Full Vibe AI may withdraw this permission for a distribution that
creates confusion or security risk.

## Community, source, and modified builds

A binary not published by Full Vibe AI must use the community identity shipped
for that source revision or a distinct identity chosen by its distributor. It
must not present itself as Exawatt or Official Exawatt.

The distributor must replace every origin signal under its control, including:

- product and executable name;
- icon and other product branding;
- macOS bundle identifier;
- URL protocol handler, including removal of `exawatt://`;
- signing and notarization identity;
- update channel and release metadata; and
- hosted-service endpoints, credentials, analytics configuration, and support
  route.

An unofficial build must not use Full Vibe AI's signing identity, official
update channel, credentials, or Exawatt-hosted services unless a separate
written agreement expressly permits it. Endpoint configuration or a build
label never proves that a binary is official.

A downstream product may place the following notice near its source credit:

> This product is based on Exawatt open-source software. It is independently
> produced and is not published, sponsored, or endorsed by Full Vibe AI.

## Compatibility language

You may truthfully say "compatible with the Exawatt roadmap convention" or
similar plain-text language when your implementation passes the applicable
public conformance contract. Do not use an Exawatt logo for compatibility.

"Exawatt Ready" is reserved for a future conformance program. Publication of a
specification does not grant permission to use that mark or claim
certification.

## Permission and questions

Any use not expressly permitted here requires prior written permission from
Full Vibe AI. Contact [legal@exawatt.ai](mailto:legal@exawatt.ai). Permission
for one use does not authorize another, and Full Vibe AI may require quality,
security, attribution, or distribution conditions.

Nothing in this policy limits rights that applicable law grants independently
of trademark permission, such as truthful nominative reference, commentary,
or criticism.
