# Comment Moderation Runbook

This runbook is for the tournament operator reviewing user-submitted comment
reports. The operator API is intentionally separate from public account
sessions and the iOS app.

## Configuration

Set these values in the backend runtime environment:

- `ADMIN_API_TOKEN`: secret used in the `x-admin-token` header.
- `MODERATION_OPERATOR_ID`: non-secret identifier recorded in audit fields.
- `COMMENT_REPORT_QUEUE_PAGE_SIZE`: maximum queue results per request.

The public support contact is `ruskisupport@gmail.com`. Emilio Garcia owns the
queue and normally responds within three business days. The canonical support
page source is [`docs/public/support/index.html`](public/support/index.html).

Never place the admin token in the iOS app, source control, screenshots, or
support documentation.

## Review the Queue

Use the production HTTPS API base URL and pass the admin token from the
operator's secret environment:

```bash
curl --fail-with-body \
  --header "x-admin-token: ${ADMIN_API_TOKEN}" \
  "${API_BASE_URL}/admin/comment-reports?status=open"
```

Each queue item contains the report audit record and, when still retained, the
reported comment needed for review. Reporter credentials and session tokens
are never returned.

## Record a Review

Mark a report as reviewed while investigation continues:

```bash
curl --fail-with-body \
  --request PATCH \
  --header "Content-Type: application/json" \
  --header "x-admin-token: ${ADMIN_API_TOKEN}" \
  --data '{"action":"mark_reviewed"}' \
  "${API_BASE_URL}/admin/comment-reports/REPORT_ID"
```

## Resolve a Report

Dismiss a report when the comment does not violate the standards:

```bash
curl --fail-with-body \
  --request PATCH \
  --header "Content-Type: application/json" \
  --header "x-admin-token: ${ADMIN_API_TOKEN}" \
  --data '{"action":"dismiss","note":"No standards violation found."}' \
  "${API_BASE_URL}/admin/comment-reports/REPORT_ID"
```

Remove a violating comment:

```bash
curl --fail-with-body \
  --request PATCH \
  --header "Content-Type: application/json" \
  --header "x-admin-token: ${ADMIN_API_TOKEN}" \
  --data '{"action":"remove_comment","note":"Confirmed standards violation."}' \
  "${API_BASE_URL}/admin/comment-reports/REPORT_ID"
```

Removal is transactional with report resolution. All active reports for the
same comment are resolved as `comment_removed`, and connected match clients
receive a comments refresh event after commit. Repeating a completed action is
safe and does not rewrite the original resolution.

## Response Expectations

Check the open queue during active tournament hours and follow the response
commitment on the published support page. Reports and support email are not
continuously monitored. Treat credible threats or self-harm reports as urgent
and follow applicable emergency escalation procedures rather than relying only
on comment removal.

If persistence or realtime publication fails, preserve the report as open,
record the operational error through the normal logging path, and retry after
service health is restored. Do not copy comment bodies or reporter context into
logs or external tickets.
