import { parseStableUuid } from "../domain";
import { ScheduledPodMatch } from "../scheduling";
import { EnginePersistenceInvariantError } from "./errors";
import { assertCanonicalPublishedSchedule } from "./postgres-tournament-setup.repository";

describe("canonical setup publication schedule", () => {
  const canonical = [scheduledMatch(1), scheduledMatch(2)];

  it("accepts the exact canonical match set regardless of transport order", () => {
    expect(() =>
      assertCanonicalPublishedSchedule([...canonical].reverse(), canonical)
    ).not.toThrow();
  });

  it.each([
    ["duplicate identity", [canonical[0], { ...canonical[1], id: canonical[0].id }]],
    ["duplicate sequence", [canonical[0], {
      ...canonical[1],
      sequence: canonical[0].sequence
    }]],
    ["missing match", [canonical[0]]],
    ["wrong pod", [canonical[0], {
      ...canonical[1],
      podId: parseStableUuid(uuid(99), "pod")
    }]],
    ["wrong pairing", [canonical[0], {
      ...canonical[1],
      participantTeamIds: [
        canonical[1].participantTeamIds[0],
        canonical[0].participantTeamIds[0]
      ] as const
    }]],
    ["noncanonical schedule time", [canonical[0], {
      ...canonical[1],
      scheduledAt: "2027-01-01T00:00:00.000Z"
    }]]
  ])("rejects %s", (_label, supplied) => {
    expect(() =>
      assertCanonicalPublishedSchedule(supplied, canonical)
    ).toThrow(EnginePersistenceInvariantError);
  });
});

function scheduledMatch(sequence: number): ScheduledPodMatch {
  return {
    id: parseStableUuid(uuid(100 + sequence), "match"),
    tournamentId: parseStableUuid(uuid(1), "tournament"),
    podId: parseStableUuid(uuid(10), "pod"),
    stage: "pod_play",
    sequence,
    sequenceInPod: sequence,
    roundNumber: sequence,
    gameNumberForPair: 1,
    participantTeamIds: [
      parseStableUuid(uuid(20 + sequence), "tournament_team"),
      parseStableUuid(uuid(30 + sequence), "tournament_team")
    ],
    status: "scheduled",
    scoreAvailability: "not_started",
    scheduledAt: null
  };
}

function uuid(sequence: number): string {
  return `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}
