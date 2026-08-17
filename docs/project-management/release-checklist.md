# App Store Release Checklist

This checklist complements the operational work in GitHub issue 30. GitHub
Issues remains the source of truth for work status.

## App Store Policy URLs

Use these exact production URLs in App Store Connect:

- Privacy Policy URL:
  https://emiliog2004.github.io/Ruski-Report/privacy/
- Support URL:
  https://emiliog2004.github.io/Ruski-Report/support/
- Community Standards URL:
  https://emiliog2004.github.io/Ruski-Report/community-standards/
- Optional User Privacy Choices URL:
  https://emiliog2004.github.io/Ruski-Report/privacy/#your-choices

The iOS `AppConfig.json` records the first three URLs. Deploy-time overrides are
available through `RUSKI_PRIVACY_POLICY_URL`, `RUSKI_SUPPORT_URL`, and
`RUSKI_COMMUNITY_STANDARDS_URL`.

## iOS Release Identity

- [x] Set the production bundle identifier to
      `com.emiliogarcia.ruskireport`.
- [x] Set the display name and initial version to `Ruski Report` 1.0 (1).
- [x] Limit v1 to portrait iPhone on iOS 17 or later.
- [x] Remove native iPad, macOS, Mac Catalyst, and visionOS targets.
- [x] Provide opaque default, dark, and grayscale tinted 1024-by-1024 icons.
- [x] Derive the OSLog subsystem and Keychain service from the bundle identity.
- [x] Validate a generic-device Release build and unsigned archive without
      missing-icon, entitlement, or platform warnings.
- [x] Attempt automatic development and App Store provisioning and record the
      Apple account prerequisites reported on July 28, 2026.
- [ ] Enroll the current Apple account in the Apple Developer Program or select
      an enrolled team with App Store Connect access.
- [ ] Complete any required Apple Developer and App Store Connect agreements.
- [ ] Register `com.emiliogarcia.ruskireport` with the Apple Developer account
      and create or download its provisioning profile.
- [ ] Register an iPhone with the development team before validating a signed
      development-device build.
- [ ] Produce and validate a signed distribution archive.

The detailed contract and local commands are in
[`docs/ios-release-configuration.md`](../ios-release-configuration.md).

## App Store Age Rating

- [x] Record 18+ as the intended v1 storefront rating.
- [x] Keep icon artwork free of visible alcohol, consumption, branding, and
      youth-oriented imagery.
- [x] Prohibit comments that encourage underage, dangerous, or excessive
      alcohol consumption.
- [ ] Complete the App Store Connect questionnaire from the shipped binary and
      metadata.
- [ ] Use Apple's higher-rating override if the calculated rating is below 18+.

The App Store rating does not replace account eligibility or age verification.
The current service policy remains that people under 13 may not create accounts
or post comments.

## Policy Publication

- [x] Public sources contain Emilio Garcia's operator identity.
- [x] Support uses `ruskisupport@gmail.com`.
- [x] Support promises a response within three business days.
- [x] Pages state that the project has no school affiliation.
- [x] Pages state that people under 13 may not create accounts or comment.
- [x] Privacy copy states that no analytics, advertising, or tracking is used.
- [x] Tournament records are described as permanently retained.
- [x] Comments are described as retained indefinitely, with account deletion
      and moderation behavior explained.
- [x] Account-deletion claims match the PostgreSQL cascade and report
      anonymization behavior.
- [x] `node scripts/validate-policy-site.mjs` passes.
- [x] Enable GitHub Pages with GitHub Actions as its publishing source.
- [x] Run the `Publish policy site` workflow from the production source.
- [x] Verify every production URL returns HTTP 200 and matches its committed
      source.
- [ ] Inspect every production page visually at a phone-sized width.
- [ ] Confirm App Store Connect privacy answers match the published policy.
- [ ] Enter the privacy and support URLs in App Store Connect.

## Raspberry Pi Privacy Gates

Complete these when production networking and storage are selected:

- [x] Serve app API and realtime traffic over HTTPS.
- [x] Record any tunnel, reverse-proxy, DNS, or hosting provider that processes
      production request metadata.
- [x] Confirm each provider can protect data consistently with the privacy
      policy; update the policy before adding a provider with broader use.
- [x] Configure persistent logs and rotating backups, if enabled, with a
      maximum 30-day retention.
- [ ] Verify logs exclude passwords, raw session tokens, comment bodies, report
      context, and reporter identities.
- [ ] Exercise account deletion against the production database and confirm
      authored comments, credentials, sessions, and blocks are removed.
