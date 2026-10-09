import assert from "node:assert/strict";
import test from "node:test";

import { validateDiscoveryState } from "./production-read.mjs";

const legacyTournament = {
  id: "tournament-2026",
  year: 2026
};

test("accepts the completed legacy tournament only in canonical history", () => {
  assert.doesNotThrow(() => validateDiscoveryState({
    legacyTournament,
    v2Active: discovery(["fall-2027"]),
    v2History: discovery(["tournament-2026"], "completed", 2026),
    expectedActiveTournamentIds: ["fall-2027"],
    legacyTournamentYear: 2026
  }));
});

test("rejects a missing or unexpected canonical active tournament", () => {
  assert.throws(() => validateDiscoveryState({
    legacyTournament,
    v2Active: discovery([]),
    v2History: discovery(["tournament-2026"], "completed", 2026),
    expectedActiveTournamentIds: ["fall-2027"],
    legacyTournamentYear: 2026
  }), /does not match the operator-declared set/u);
});

test("rejects the completed legacy tournament in active discovery", () => {
  assert.throws(() => validateDiscoveryState({
    legacyTournament,
    v2Active: discovery(["tournament-2026"], "pod_play", 2026),
    v2History: discovery(["tournament-2026"], "completed", 2026),
    expectedActiveTournamentIds: ["tournament-2026"],
    legacyTournamentYear: 2026
  }), /incorrectly listed as active/u);
});

test("rejects a missing or non-historical 2026 canonical projection", () => {
  assert.throws(() => validateDiscoveryState({
    legacyTournament,
    v2Active: discovery([]),
    v2History: discovery([]),
    expectedActiveTournamentIds: [],
    legacyTournamentYear: 2026
  }), /absent from v2 history/u);
  assert.throws(() => validateDiscoveryState({
    legacyTournament,
    v2Active: discovery([]),
    v2History: discovery(["tournament-2026"], "pod_play", 2026),
    expectedActiveTournamentIds: [],
    legacyTournamentYear: 2026
  }), /invalid canonical historical lifecycle/u);
});

function discovery(ids, lifecycle = "pod_play", year = 2027) {
  return {
    contractVersion: 2,
    tournaments: ids.map((id) => ({
      projection: { version: 1 },
      tournament: { id, year, lifecycle }
    }))
  };
}
