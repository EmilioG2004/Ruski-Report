# Repositories

Persistence interfaces and implementations belong here. Services should depend
on repository contracts rather than direct database access.

Repository contracts are intentionally separated by responsibility:

- snapshot publishing writes normalized tournament snapshots atomically
- tournament reads return active tournament and match data
- comments are app-created data and are not replaced by scorebook publishing
- upload reports preserve validation and publish history for admin workflows
