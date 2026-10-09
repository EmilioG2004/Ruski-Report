# App Store Connect Metadata

This is the reviewed source for the first US-only, free, no-IAP Ruski Report
release. App Store Connect remains authoritative for values entered there.
Never store the App Review password, Apple credentials, session material, or
administrator credentials in this file or in Git.

## App Record

| Field | Value |
| --- | --- |
| Platform | iOS |
| Name | Ruski Report |
| Primary language | English (U.S.) |
| Bundle ID | `com.emiliogarcia.ruskireport` |
| SKU | `RUSKI-REPORT-IOS-1` |
| User access | Full Access |
| Availability | United States only |
| Price | Free |
| In-App Purchases | None |
| Primary category | Sports |
| Secondary category | Entertainment |
| Copyright | 2026 Emilio Garcia |

The Paid Apps Agreement, banking, and tax setup are not required for this
free, no-IAP release. Reopen those gates before adding a price or IAP.

## English (U.S.) Product Page

### Subtitle

Scores, stats, and brackets

### Promotional Text

Follow official tournament scores, standings, brackets, detailed match
records, and live updates from opening play through the championship.

### Description

Ruski Report is the viewing-first home for official Ruski tournament results.
Follow a tournament from pod play through the championship with clear live,
scheduled, and final match states.

Browse:

- Live and final scores
- Pod standings and qualifier seeds
- Championship brackets and advancement
- Team and player statistics
- Detailed match plays and scorecards
- Current and completed tournament history

Tournament viewing is available without an account. Create an optional account
to join public match discussion. Comment reporting, user blocking, community
standards, and in-app account deletion are built in.

Ruski Report is an independent tournament tracker operated by Emilio Garcia.
It is not affiliated with, sponsored by, or endorsed by a school or educational
institution. The app contains no advertising, tracking, in-app purchases, or
gambling features.

### Keywords

`tournament,scores,standings,bracket,statistics,matches,live results,scorecard`

### What’s New In Version 1.0

The first Ruski Report release includes guest tournament viewing, live score
updates, standings, statistics, brackets, detailed scorecards, tournament
history, public match comments, reporting and blocking controls, and in-app
account deletion.

### URLs

- Support: https://emiliog2004.github.io/Ruski-Report/support/
- Privacy policy: https://emiliog2004.github.io/Ruski-Report/privacy/
- User privacy choices:
  https://emiliog2004.github.io/Ruski-Report/privacy/#your-choices
- Marketing: https://emiliog2004.github.io/Ruski-Report/

## Screenshots

The following four privacy-reviewed iPhone 17 Pro portrait images were uploaded
in order to the iPhone with Dynamic Island medium-display slot. Each is a
1206 × 2622 RGB PNG without an alpha channel. The files use deterministic
synthetic tournament fixtures and contain no private account, community, or
operational content.

| Order | Artifact | SHA-256 |
| --- | --- | --- |
| 1 | `01-score-feed.png` | `f9caa3d1a89a407ecbc0314247ba3e3996641fa8559d5dd064f3c4664f05d170` |
| 2 | `02-standings.png` | `5e469a3000e5096bb7e85a84ce4835c2f8b5b9df2c302568eef241e1be9a46fb` |
| 3 | `03-bracket.png` | `235d70a38c0d0b526c092a55b30cfa6aafd3bed73873571d03a508ab1dcb3988` |
| 4 | `04-match-scorecard.png` | `170d2bc7456108890690fe6d328aad8da7d129a517200fdadce352762e01bb1d` |

An app preview video is not required for v1.

## App Privacy

Select **Yes, data is collected**. Do not select tracking for any data type.
The app has no advertising or cross-app tracking.

These answers and both privacy URLs were published in App Store Connect on
October 8, 2026.

| App Store data type | Linked to user | Purpose | Shipped behavior |
| --- | --- | --- | --- |
| Contact Info → Name | Yes | App Functionality | Optional public-account display name. |
| Identifiers → User ID | Yes | App Functionality | Opaque public account ID and authenticated session relationship. |
| User Content → Other User Content | Yes | App Functionality | Public match comments, private report reason/context, and blocking choices. |
| User Content → Customer Support | Yes | App Functionality | Information intentionally sent through the support-email workflow. |
| Diagnostics → Other Diagnostic Data | No | App Functionality | Content-minimized request outcome, reliability, and security metadata. |

Passwords are not an App Store privacy data type and are never stored raw.
Tournament rosters, scores, brackets, and statistics are official public
tournament records rather than public-account profile data. Cloudflare and AWS
provider processing described in the privacy policy must remain reflected in
the answers if the production architecture changes.

## Age Rating

Answer from the shipped binary and production service:

| Descriptor or capability | Answer |
| --- | --- |
| Parental Controls | No |
| Age Assurance | No |
| Unrestricted Web Access | No |
| User-Generated Content | Yes |
| Social Media | No |
| Social Media Disabled for Users Under 13 | No |
| Messaging and Chat | Yes — public match comments only |
| Advertising | No |
| Profanity or Crude Humor | Infrequent/Mild due to moderated user comments |
| Alcohol, Tobacco, or Drug Use or References | Infrequent/Mild |
| Gambling or Contests | No |
| All violence, horror, medical, sexual, nudity, and loot-box descriptors | None |

Use Apple's **18+ override** if the calculated United States rating is lower.
The service policy separately prohibits people under 13 from creating accounts
or posting comments; it is not an age-verification mechanism.

## Export Compliance And Content Rights

The app uses only exempt encryption supplied by Apple's operating system for
HTTPS/WSS and Keychain services. `ITSAppUsesNonExemptEncryption` is `NO` in the
processed Info.plist, so no encryption documentation is expected.

The app contains no licensed music, video, third-party branding, or copied
media. It displays operator-supplied tournament records and user comments. On
October 8, 2026, the account holder confirmed authorization to publish the
tournament, team, roster, and match information, and App Store Connect was
saved with the declaration that the app has the necessary rights to its
third-party content.

## App Review Information

Use display name `AppReview`. Its durable non-administrator password is stored
in the macOS Keychain item named `Ruski Report App Review` and must never be
copied into Git or release evidence. The reviewer does not need an
administrator account and must never receive one.

The account, reviewer contact information, review notes, and manual release
selection were saved in App Store Connect on October 8, 2026.

### Review Notes

Ruski Report is a viewing-first tournament app. Guest mode provides tournament,
standings, bracket, match, scorecard, and statistics access without signing in.
The supplied demo account enables public match comments, report and block
controls, and in-app account deletion.

The completed 2026 tournament appears under the history button on the Scores
screen. There may be no active tournament outside an event window; this is an
expected state, not a loading failure. Select the history button, open the 2026
tournament, and choose any match to inspect its result, scorecard, statistics,
and comments.

Tournament results are imported by a private administrator workflow that is
not part of the iOS app and is not required for review. The app has no IAP,
advertising, tracking, wagering, or school affiliation. Account deletion is
available under Account → Delete Account. Community standards, privacy, and
support links are available from the Account screen.

## Release Boundaries

- iOS 1.0 (1) remains in the manually managed `Phase 7 Internal` group.
  Automatic distribution of future builds is disabled.
- The invited account holder installed this exact build and completed the
  physical production smoke test.
- On October 8, 2026, the owner explicitly accepted the residual risk of
  submitting before Apple populated the longer TestFlight metrics window.
- iOS 1.0 build 1 was submitted as the only App Review item under submission
  `94795588-3d55-4695-a052-13d80be905a7` and reached `Waiting for Review`.
- Manual App Store release remains selected; approval does not authorize an
  automatic storefront release.
- Availability remains United States only.
- The app remains free with no IAP.
