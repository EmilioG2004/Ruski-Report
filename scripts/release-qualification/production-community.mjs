/**
 * Exercises disposable account, comment, reporting, blocking, moderation, and
 * deletion flows. Every created account is removed even after a failed check.
 */

import { randomBytes } from "node:crypto";

import { observeRealtimeEvent } from
  "../../backend/scripts/realtime-event-observer.mjs";
import { DisposableAccount } from "./disposable-account.mjs";
import { requireCondition } from "./http-client.mjs";

export async function qualifyProductionCommunity(
  client,
  adminToken,
  configuration,
  republish
) {
  const suffix = randomBytes(4).toString("hex");
  const password = `Qualification-${randomBytes(12).toString("hex")}`;
  const viewer = new DisposableAccount(client, `Qualification A ${suffix}`, password);
  const author = new DisposableAccount(client, `Qualification B ${suffix}`, password);

  try {
    await viewer.register();
    await viewer.verifySession();
    await viewer.signOutAndLogin();
    await viewer.verifySession();
    await author.register();

    const active = await client.get("tournaments/active");
    const matches = await client.get(`tournaments/${active.id}/matches`);
    requireCondition(matches.length > 0, "No match is available for community checks.");
    const matchId = matches[0].id;
    const comment = await observeMatchUpdate(
      configuration,
      active.id,
      matchId,
      () => client.post(
        `matches/${matchId}/comments`,
        { body: `Release qualification comment ${suffix}` },
        { token: author.token }
      )
    );

    const publication = await republish();
    const persisted = await client.get(`matches/${matchId}/comments`);
    requireCondition(
      persisted.some((item) => item.id === comment.id),
      "Comment did not persist across scorebook publication."
    );
    await verifyBlocking(client, viewer, author, matchId, comment.id);
    const report = await client.post(
      `comments/${comment.id}/reports`,
      { reason: "spam" },
      { token: viewer.token }
    );
    await verifyModeration(
      client,
      adminToken,
      configuration,
      active.id,
      report.id,
      matchId,
      comment.id
    );

    const rejectedStatus = await client.status(`matches/${matchId}/comments`, {
      method: "POST",
      body: { body: `Qualification blocked phrase ${suffix}` },
      token: viewer.token
    });
    requireCondition(
      rejectedStatus === 422,
      `Moderated comment returned ${rejectedStatus} instead of 422.`
    );
    return { matchId, persistencePublication: publication };
  } finally {
    await deleteDisposableAccounts([author, viewer]);
  }
}

async function deleteDisposableAccounts(accounts) {
  const results = await Promise.allSettled(
    accounts.map((account) => account.deleteIfCreated())
  );
  const failures = results
    .filter((result) => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length > 0) {
    throw new AggregateError(failures, "Synthetic account cleanup failed.");
  }
}

async function verifyBlocking(client, viewer, author, matchId, commentId) {
  await client.put(`account/blocks/${author.userId}`, undefined, {
    token: viewer.token
  });
  const hidden = await client.get(`matches/${matchId}/comments`, {
    token: viewer.token
  });
  requireCondition(
    !hidden.some((comment) => comment.id === commentId),
    "Blocking did not hide the account's comment."
  );
  await client.delete(`account/blocks/${author.userId}`, { token: viewer.token });
  const restored = await client.get(`matches/${matchId}/comments`, {
    token: viewer.token
  });
  requireCondition(
    restored.some((comment) => comment.id === commentId),
    "Unblocking did not restore the account's comment."
  );
}

async function verifyModeration(
  client,
  adminToken,
  configuration,
  tournamentId,
  reportId,
  matchId,
  commentId
) {
  const queue = await client.get("admin/comment-reports?status=open", {
    adminToken
  });
  requireCondition(
    queue.some((item) => item.report?.id === reportId),
    "Submitted report did not enter the moderation queue."
  );
  await observeMatchUpdate(
    configuration,
    tournamentId,
    matchId,
    () => client.patch(
      `admin/comment-reports/${reportId}`,
      { action: "remove_comment", note: "Automated release qualification." },
      { adminToken }
    )
  );
  const comments = await client.get(`matches/${matchId}/comments`);
  requireCondition(
    !comments.some((comment) => comment.id === commentId),
    "Moderation did not remove the reported comment."
  );
}

function observeMatchUpdate(configuration, tournamentId, matchId, action) {
  return observeRealtimeEvent({
    publicBaseUrl: configuration.publicBaseUrl,
    subscription: { scope: "match", tournamentId, matchId },
    expectation: { type: "comments.updated", tournamentId, matchId },
    action,
    timeoutMilliseconds: configuration.realtimeEventTimeoutMilliseconds
  });
}
