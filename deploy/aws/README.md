# AWS Production Infrastructure

`backup-stack.yml` provisions the AWS half of the Ruski Report backup design:

- A private S3 bucket named
  `ruski-report-backups-ACCOUNT_ID-us-east-1` when deployed in `us-east-1`.
- S3-managed encryption in addition to restic's client-side encryption.
- Block Public Access, disabled ACLs, TLS-only access, and versioning.
- One-day noncurrent-version retention and seven-day incomplete-upload cleanup.
- A dedicated IAM user restricted to the bucket's `restic/` prefix.

`monitoring-stack.yml` is deliberately separate from backup storage. It
provisions:

- A Node.js 22 Lambda that checks public HTTPS, PostgreSQL readiness through
  `/api/health`, and two successive Socket.IO WSS connections every five
  minutes.
- CloudWatch alarms for failed checks and missing scheduled invocations.
- An SNS email subscription for the operator and 30-day monitor-log retention.

CloudFormation retains the bucket if the stack is deleted. That guard prevents
a stack deletion from also deleting the backups. The Pi identity is deliberately
unable to call `s3:DeleteObjectVersion`, so it cannot permanently purge an S3
version even though restic can prune current repository objects.

## Provision Through the AWS Console

Use an administrative identity protected by MFA. Do not create an access key
for the AWS account root user.

1. Sign in to AWS and select **US East (N. Virginia) / us-east-1**.
2. Open **CloudFormation > Stacks > Create stack > With new resources**.
3. Choose **Upload a template file** and upload `backup-stack.yml`.
4. Name the stack `ruski-report-backups` and keep the default stack options.
5. Review the template, acknowledge that it creates named IAM resources, and
   submit it.
6. Wait for `CREATE_COMPLETE`, then open **Outputs**. Record the bucket name,
   IAM username, and restic repository URL; none of those values is secret.

CloudFormation creates the IAM user but never creates or prints a credential.
After the stack succeeds, open **IAM > Users > ruski-report-pi-backup > Security
credentials > Create access key**. Select the use case for an application
running outside AWS. Copy the access-key ID and secret access key directly into
the Pi's root-only secret file using the Raspberry Pi operations runbook. The
secret access key is displayed only once.

## Provision The Monitoring Stack

After the Pi API returns
`{"status":"ok","service":"ruski-report-backend","database":"ok"}`, create
a separate stack through the AWS console:

1. Keep **US East (N. Virginia) / us-east-1** selected.
2. Open **CloudFormation > Stacks > Create stack > With new resources**.
3. Choose **Upload a template file**, upload
   `deploy/aws/monitoring-stack.yml`, and choose **Next**.
4. Set the stack name to `ruski-report-monitoring`.
5. Confirm `OperatorAlertEmail` is `ruskisupport@gmail.com` and
   `PublicBaseUrl` is `https://api.ruskireport.com`.
6. Keep the default stack options, choose **Next**, acknowledge that the
   template creates named IAM resources, and choose **Submit**.
7. Wait for `CREATE_COMPLETE`. This separate stack does not alter the existing
   backup bucket, IAM user, or Pi access key.

AWS sends an email with the subject **AWS Notification - Subscription
Confirmation** from `no-reply@sns.amazonaws.com`. Open it, verify that the
topic name ends in `ruski-report-operator-alerts`, and choose **Confirm
subscription**. Until that link is confirmed, alarms cannot reach the operator.
The confirmation page should report `Subscription confirmed!`; it does not ask
for an AWS password.

The missing-invocation alarm may briefly enter `ALARM` while the first scheduled
check is pending. Wait for the Lambda's first successful scheduled invocation
before treating that bootstrap state as an incident.

## Verify Monitoring And Alerts

First prove the healthy path:

1. Open **Lambda > Functions > ruski-report-public-monitor > Test**.
2. Create an event named `healthy-check` with `{}` as its JSON and choose
   **Test**.
3. Confirm the execution result says **Succeeded** and its returned status is
   `ok`.
4. Open **Monitor > View CloudWatch logs**. Confirm the latest entry names only
   the checked origin and duration; it must not contain credentials or response
   bodies.
5. Open **CloudWatch > Alarms > All alarms**. Both `ruski-report-public-monitor`
   alarms should become **OK** after metric evaluation.

Then prove that an outage reaches the operator without interrupting production:

1. In the same Lambda **Test** tab, create an event named `controlled-failure`
   with `{"forceFailure":true}` and choose **Test** once. The intentional test
   must show **Failed**.
2. Wait up to five minutes for
   `ruski-report-public-monitor-errors` to enter **In alarm** and for the SNS
   alarm email to reach `ruskisupport@gmail.com`.
3. Run `healthy-check` again. The scheduled check remains enabled, and the
   alarm should return to **OK** after the next metric evaluation. A recovery
   email confirms the full path.

Do not disable the schedule or take the Pi offline to test alerts. The
`forceFailure` event exercises Lambda errors, CloudWatch, SNS, and email without
changing public availability.

## CLI Equivalent

An authenticated AWS CLI can validate and deploy both templates:

```bash
aws cloudformation validate-template \
  --region us-east-1 \
  --template-body file://deploy/aws/backup-stack.yml
```

```bash
aws cloudformation deploy \
  --region us-east-1 \
  --stack-name ruski-report-backups \
  --template-file deploy/aws/backup-stack.yml \
  --capabilities CAPABILITY_NAMED_IAM
```

```bash
aws cloudformation validate-template \
  --region us-east-1 \
  --template-body file://deploy/aws/monitoring-stack.yml
```

```bash
aws cloudformation deploy \
  --region us-east-1 \
  --stack-name ruski-report-monitoring \
  --template-file deploy/aws/monitoring-stack.yml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
    OperatorAlertEmail=ruskisupport@gmail.com \
    PublicBaseUrl=https://api.ruskireport.com
```

Creating the Pi access key remains a separate, intentional step. Never place
that key in CloudFormation parameters, shell history, Git, screenshots, issue
comments, or CI logs.

## Cost And Retention

S3 charges for stored bytes and requests. Lambda, EventBridge, CloudWatch, and
SNS also have usage-based pricing. The expected small database, deduplicated
hourly snapshots, and 8,640 monitor runs in a typical 30-day month are low
volume, but the account owner should enable AWS billing alerts before
production rather than assuming the deployment is free. Restic retains
snapshots for 27 days. S3 lifecycle rules expire noncurrent restic object
versions after one day, leaving operational margin under the published 30-day
backup limit. The Lambda log group retains monitor logs for exactly 30 days.

S3 lifecycle rules do not delete current restic objects by age. Doing that
would corrupt the repository because restic packs are shared by snapshots.
Restic alone performs current-object pruning.
