# ADR 0007: Store Encrypted Backups in Amazon S3

## Status

Accepted

## Context

The Raspberry Pi is the single production host for the API and PostgreSQL.
Its database currently resides on the Pi's microSD card, so a card failure,
host loss, or operator error could remove both the live data and any backup
stored on the same device. Issue 37 requires scheduled backups outside the live
database volume, retention, restore verification, and documented recovery.

The backup contains normalized tournament records and may also contain account,
comment, moderation, and deployment-secret data. The public privacy policy
limits rotating production backups to 30 days. The solution therefore needs
off-site durability, encryption, least-privilege access, and bounded retention.

## Decision

Use a private Amazon S3 bucket in `us-east-1` as the off-site backup target.
Provision the bucket and its dedicated Pi IAM user through AWS CloudFormation.
The bucket blocks all public access, rejects non-TLS requests, uses S3-managed
server-side encryption, has ACLs disabled, and retains short-lived object
versions for deletion recovery.

Run `restic` on the Pi so backup contents are encrypted before they leave the
host. The restic repository password is independent of the AWS access key. Both
remain in root-only files outside Git, and an offline copy of the repository
password is kept in the operator's password manager. The IAM user can list and
modify only the bucket's `restic/` prefix and cannot permanently delete a
specific S3 object version.

Every hour, the Pi creates a PostgreSQL custom-format logical dump and stages
the required deployment configuration and canonical source workbook copies.
Restic uploads the encrypted snapshot and retains snapshots for 27 days. S3
expires noncurrent object versions after one day; the shorter restic window
leaves room for S3 lifecycle processing while staying within the published
30-day backup limit. A weekly repository check reads a rotating data subset.

A restore rehearsal restores a selected snapshot into an isolated, temporary
PostgreSQL container. A temporary API container then reads a restored
tournament through the same unauthenticated API route used by production. The
rehearsal never overwrites the live database.

## Rationale

S3 separates backup failure domains from the Pi, the microSD card, and the
Miami homelab. CloudFormation makes the security controls reviewable and
repeatable. Restic provides client-side authenticated encryption,
deduplication, integrity checking, snapshot retention, and portable restores
without writing a custom backup format.

Hourly logical dumps are inexpensive for the expected database size and limit
the normal recovery point to roughly one hour. PostgreSQL custom-format dumps
are portable across storage devices and can be inspected before restoration.

## Alternatives Considered

### Local USB Storage Only

A USB SSD is useful for primary database reliability and fast local recovery,
but it remains in the same physical location and may share power, host, and
operator failure modes. It is not sufficient as the only backup target.

### Consumer Cloud-Sync Folder

Copying dumps into a synced folder is easy, but access policy, retention,
versioning, and infrastructure configuration are harder to review and
reproduce. It also provides less direct experience with cloud object storage
and IAM.

### PostgreSQL Physical Backups

Physical base backups and write-ahead-log archiving can provide point-in-time
recovery. They add operational complexity that is not justified by the v1 data
volume or recovery objectives. They remain an option if the service later
needs a substantially smaller recovery point.

### S3 Object Lock

Object Lock provides stronger immutability, but it complicates restic pruning
and the strict 30-day deletion policy. Short-lived S3 versions plus a Pi IAM
identity that lacks version-deletion permission provide limited accidental or
malicious deletion recovery without preventing scheduled retention.

## Consequences

AWS S3 requests and storage have a small ongoing cost. The operator must retain
the restic repository password; losing it makes the backup unreadable. A
long-lived access key exists on the on-premises Pi and must be scoped, stored
with mode `0600`, reviewed, and rotated.

Logical dumps do not provide point-in-time recovery between hourly snapshots.
The source-workbook directory must be populated by the tournament operator
because upload request bytes are deliberately not retained by the API.

Backups are not considered production-ready until CloudFormation provisioning,
the first automated backup, a repository check, and an isolated restore
rehearsal have all succeeded and their non-secret evidence is recorded.
