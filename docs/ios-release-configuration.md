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

Environment-specific API, realtime, and public-policy URLs remain in
`AppConfig.json` and its documented deployment overrides. They do not belong
in the release identity configuration.

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

Validate the icon files and resolved Release settings without launching a
simulator:

```bash
scripts/validate-ios-release.sh
```

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
launch metadata, supported platforms, and archive structure. Producing the
signed distribution archive additionally requires registering the bundle
identifier and allowing Xcode to create or download the matching provisioning
profile through the configured Apple Developer account.
