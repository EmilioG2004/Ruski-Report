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

## Reporting and Review

Signed-in users can choose **Report Comment** from a comment's action menu,
select a reason, and optionally add context. Selecting **Other** requires
context. Repeated submission of the same report does not create duplicate
work, and rate limits prevent one account from overwhelming the operator
queue.

Reports are reviewed by the tournament operator. The operator may dismiss a
report, mark it reviewed, or remove the comment from public match feeds.
Removing a comment refreshes connected clients without requiring an app or
backend redeployment.

The real production support contact and a response-time commitment must be
published before issue 41 is closed. They are intentionally not represented by
placeholder contact information in this repository.

## Current Scope

Issues 40 and 41 provide pre-publication filtering, user reporting, and
operator review. User blocking remains a separate safeguard tracked by issue
42 and must be implemented before this document claims that users can block
accounts.

The final public, mobile-readable version of these standards and operator
contact information will be published as part of issue 43. Until then, this
repository document is the implementation source of truth rather than the App
Store support URL.
