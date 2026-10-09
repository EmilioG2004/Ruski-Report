# iOS Release Configuration

This document records the v1 iOS release contract implemented by GitHub issue
44. App Store Connect remains the source of truth for storefront metadata and
age-rating answers once an app record exists.

## v1 Release Contract

| Setting | v1 value |
| --- | --- |
| Display name | `Ruski Report` |
| Bundle identifier | `com.emiliogarcia.ruskireport` |
| Marketing version | `1.0` |
| Build number | `1` |
| Minimum OS | iOS 17.0 |
| Device family | iPhone |
| Orientation | Portrait |
| Signing | Automatic, team `F4784JNT6Y` |
| App Store age-rating target | 18+ |

The v1 target does not advertise native iPad, macOS, Mac Catalyst, or visionOS
support. Apple may still make an iPhone app available through iPad
compatibility mode. Native layouts for those platforms can be reconsidered
only after their release behavior has dedicated validation.

## Configuration Sources

Release identity and platform settings live in:

- `Configuration/Shared.xcconfig`
- `Configuration/Debug.xcconfig`
- `Configuration/Release.xcconfig`

The API environment is selected by Xcode's build configuration:

| Configuration | API base URL | Realtime URL |
| --- | --- | --- |
| Debug | `http://127.0.0.1:3000/api` | `ws://127.0.0.1:3000/socket.io/` |
| Release | `https://api.ruskireport.com/api` | `wss://api.ruskireport.com/socket.io/` |

`Debug.xcconfig` and `Release.xcconfig` supply the API URL while
`Configuration/App-Info.plist` expands it into the processed app Info.plist.
`AppConfig.json` contains only the public policy links. The Debug Run scheme
may override its endpoint with `RUSKI_API_BASE_URL`; Release builds ignore that
process environment override and always use their bundled value. This keeps
archive-time source edits out of the release process.

`AppConfig` permits HTTP only for loopback development in Debug builds. A
Release build requires a credential-free HTTPS URL and its compiled fallback
is the same production endpoint. The realtime client derives its URL from the
API URL, replacing HTTPS with WSS and using the Socket.IO path. No API key,
administrator credential, tunnel token, or AWS credential belongs in either
configuration.

App Transport Security remains at its secure default. The target does not add
`NSAppTransportSecurity` exceptions; Debug loopback access is isolated from
the production archive.

The app derives its OSLog subsystem and Keychain service from the installed
bundle identifier. Changing the canonical bundle identifier therefore does not
leave runtime services tied to the old development identifier.

## App Icon

`AppIcon.appiconset` contains three opaque 1024-by-1024 PNG sources:

- A default full-color icon.
- A subdued dark-appearance icon.
- A grayscale tinted-appearance icon.

Every appearance keeps the same generic red party cup and airborne ping-pong
ball composition. The artwork contains no text, logo, trademark, school
branding, visible liquid, alcohol container, person drinking, or consumption
prompt. It presents the app as a cup-and-ball tournament tracker instead of an
alcohol advertisement.

## Age Rating and Alcohol Posture

The App Store submission should target an 18+ rating. Answer the App Store
Connect questionnaire according to the shipped binary and metadata, then use
Apple's higher-rating override if the calculated result is lower.

The storefront rating and the service eligibility policy are different
controls. The current service policy continues to prohibit accounts and
comments from people under 13; an App Store rating does not perform identity
or age verification.

Ruski Report v1 is a tournament results, statistics, discussion, and archive
viewer. It must not add drink timers, consumption prompts, rewards or penalties
based on drinking, or instructions encouraging dangerous or excessive alcohol
consumption. User comments that encourage underage, dangerous, or excessive
drinking violate the community standards and remain subject to reporting,
blocking, and operator moderation.

## Local Validation

Validate the icon files, resolved Release settings, and archived networking
without launching a simulator:

```bash
scripts/validate-ios-release.sh
```

The script creates a temporary unsigned Release archive and verifies:

- The processed Info.plist contains `https://api.ruskireport.com/api` and the
  `Release` configuration marker.
- The app contains no loopback HTTP/WebSocket service endpoint.
- The app contains no App Transport Security exception.
- The app contains no server credential marker.

Compile and archive against a generic iOS device:

```bash
xcodebuild \
  -project "Ruski Report.xcodeproj" \
  -scheme "Ruski Report" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath /tmp/RuskiReport.xcarchive \
  CODE_SIGNING_ALLOWED=NO \
  archive
```

The unsigned archive verifies compilation, asset-catalog processing, generated
launch metadata, supported platforms, archive structure, and the production
network configuration. Producing the signed distribution archive additionally
requires registering the bundle identifier and allowing Xcode to create or
download the matching provisioning profile through the configured Apple
Developer account.

## Provisioning Status

Provisioning was attempted on July 28, 2026 with automatic signing and
`-allowProvisioningUpdates`. The project configuration reached Apple's
developer services, but the configured team could not complete either signing
path:

- A development archive could not create a profile because the team has no
  registered iPhone.
- An App Store export reported that the current user has no associated App
  Store Connect provider and that team `F4784JNT6Y` cannot create an iOS App
  Store provisioning profile.

These are Apple account and device prerequisites, not build or asset-catalog
failures. Before retrying App Store signing, enroll the current account in the
Apple Developer Program or select an enrolled team with App Store Connect
access, complete any required agreements, and let Xcode create or download the
distribution profile. Registering a physical iPhone is additionally required
for development-device profiles, but not for App Store distribution.
