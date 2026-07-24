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

## Blocking

Signed-in users can choose **Block User** from another account's comment and
confirm the action. Comments from that account are then hidden for the blocking
user. The blocked list can be reviewed and changed under
**Account > Blocked Users**; unblocking restores the account's comments on the
next refresh.

Blocking is private and affects only the blocking user's view. It does not
report the comment, remove it for anyone else, notify the blocked account, or
give the blocking user moderation privileges. Guests continue to see the
public, unfiltered comment feed because they do not have an account-specific
block list.

## Current Scope

Issues 40, 41, and 42 provide pre-publication filtering, user reporting,
operator review, and private user blocking. The backend is the enforcement
boundary for submission moderation, operator authorization, block ownership,
and authenticated comment filtering.

The final public, mobile-readable version of these standards and operator
contact information will be published as part of issue 43. Until then, this
repository document is the implementation source of truth rather than the App
Store support URL.
