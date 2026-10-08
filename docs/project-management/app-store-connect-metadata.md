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

Upload these five privacy-reviewed iPhone 17 Pro Max portrait images in order.
Each is 1320 × 2868 PNG without an alpha channel, which satisfies the 6.9-inch
iPhone requirement. The files use synthetic production-like tournament data
and contain no private account or community content.

| Order | Artifact | SHA-256 |
| --- | --- | --- |
| 1 | `01-home.png` | `02c378a4a774721a93ae0ff9b8780e1fd0419af6ba042b765f07fd35e025b643` |
| 2 | `02-tournament-overview.png` | `8c5b6ca99636331ac8d7877585f4d6f082b97460346f05bd769f4ea1cd82cf4b` |
| 3 | `03-pod-standings.png` | `35a8be22952bd3b34acd36c9a7102d4c5aa8bde407c416b784b0c1d46d7c71dc` |
| 4 | `04-bracket.png` | `f25d6dbd02b4862abe0cc57446713c2023e1d6cfee52755ec66037b6fdbc1847` |
| 5 | `05-match-detail.png` | `ee976fe300bef0aba63e4d811d7ad937c9525638053d15672877b0b00f78c21a` |

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

- iOS 1.0 (1) is Ready to Test in the manually managed `Phase 7 Internal`
  group. Automatic distribution of future builds is disabled.
- The invited account holder must install this exact build and complete the
  production smoke test and observation window tracked by issue 47.
- TestFlight upload does not authorize App Review submission.
- Do not add the build to a review submission until the internal TestFlight
  production smoke test and observation window pass.
- Availability remains United States only.
- The app remains free with no IAP.
