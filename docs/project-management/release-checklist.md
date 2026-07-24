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
- [ ] Enable GitHub Pages with GitHub Actions as its publishing source.
- [ ] Run the `Publish policy site` workflow from the production source.
- [ ] Verify every production URL returns successfully on a phone-sized screen.
- [ ] Confirm App Store Connect privacy answers match the published policy.
- [ ] Enter the privacy and support URLs in App Store Connect.

## Raspberry Pi Privacy Gates

Complete these when production networking and storage are selected:

- [ ] Serve app API and realtime traffic over HTTPS.
- [ ] Record any tunnel, reverse-proxy, DNS, or hosting provider that processes
      production request metadata.
- [ ] Confirm each provider can protect data consistently with the privacy
      policy; update the policy before adding a provider with broader use.
- [ ] Configure persistent logs and rotating backups, if enabled, with a
      maximum 30-day retention.
- [ ] Verify logs exclude passwords, raw session tokens, comment bodies, report
      context, and reporter identities.
- [ ] Exercise account deletion against the production database and confirm
      authored comments, credentials, sessions, and blocks are removed.
