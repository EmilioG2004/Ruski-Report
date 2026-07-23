# Ruski Report Community Standards

Ruski Report match comments are for constructive discussion of tournament play.
These standards describe the content that the automated submission filter
rejects and the broader rules that moderation features must enforce.

## Prohibited Content

Do not post:

- Harassment, bullying, humiliation, or targeted personal abuse.
- Discriminatory or hateful language aimed at a protected group.
- Threats, encouragement of self-harm, or encouragement of violence.
- Sexually explicit, exploitative, or pornographic material.
- Content promoting illegal activity or dangerous conduct.
- Repeated messages, excessive links, or other disruptive spam.
- Attempts to disguise prohibited language with case, width, whitespace, or
  punctuation changes.

## Automated Enforcement

The backend normalizes every authenticated comment submission before it is
stored. It rejects configured prohibited phrases, excessive links, excessive
character or word repetition, empty or oversized bodies, and recently repeated
comments. The app shows a general, actionable explanation without publishing
the matched phrase or private filter rule.

Automated filters reduce immediate abuse but cannot determine every context.
The operator-maintained rule file can be updated without changing the iOS app.
Filter decisions are logged without the rejected comment body or account
credentials.

## Current Scope

Issue 40 provides pre-publication filtering. User reporting, moderator review,
and user blocking are separate safeguards tracked by issues 41 and 42. Those
capabilities must be implemented before this document claims that users can
report content or block accounts.

The public, mobile-readable version of these standards and operator contact
information will be published as part of issue 43. Until that work is complete,
this repository document is the implementation source of truth rather than the
App Store support URL.
