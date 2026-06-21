import { readFileSync } from "node:fs";
import { join } from "node:path";

import { GameEvent } from "../../../domain";
import {
  RUSKI_EVENT_TYPE_IDS,
  RUSKI_GAME_TYPE,
  RUSKI_STAT_KEYS,
  ruskiGameDefinition
} from "../definition";
import { RuskiGamePlugin } from "./ruski-game.plugin";

const fixturePath = join(
  process.cwd(),
  "../docs/2026 Ruski Stat Sheet.xlsx"
);

describe("RuskiGamePlugin", () => {
  it("loads the Ruski game definition", () => {
    const plugin = new RuskiGamePlugin();

    expect(plugin.gameType).toBe(RUSKI_GAME_TYPE);
    expect(plugin.loadDefinition()).toBe(ruskiGameDefinition);
  });

  it("delegates parse and validation through the plugin shell", async () => {
    const buffer = readFileSync(fixturePath);
    const plugin = new RuskiGamePlugin();

    const parsed = await plugin.parseScorebook({
      buffer,
      originalName: "2026 Ruski Stat Sheet.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: buffer.byteLength
    });

    expect(plugin.validateScorebook(parsed)).toMatchObject({
      valid: true,
      errors: []
    });
  });

  it("counts di and tri as misses when calculating Ruski stats", () => {
    const plugin = new RuskiGamePlugin();
    const boxScore = plugin.calculateStats([
      createEvent("event-1", RUSKI_EVENT_TYPE_IDS.make),
      createEvent("event-2", RUSKI_EVENT_TYPE_IDS.miss),
      createEvent("event-3", RUSKI_EVENT_TYPE_IDS.di),
      createEvent("event-4", RUSKI_EVENT_TYPE_IDS.tri),
      createEvent("event-5", RUSKI_EVENT_TYPE_IDS.vom)
    ]);

    expect(boxScore.totals).toMatchObject({
      [RUSKI_STAT_KEYS.makes]: 1,
      [RUSKI_STAT_KEYS.misses]: 3,
      [RUSKI_STAT_KEYS.dis]: 1,
      [RUSKI_STAT_KEYS.tris]: 1,
      [RUSKI_STAT_KEYS.voms]: 1
    });
  });

  it("delegates scorebook normalization through the plugin shell", async () => {
    const buffer = readFileSync(fixturePath);
    const plugin = new RuskiGamePlugin();
    const parsed = await plugin.parseScorebook({
      buffer,
      originalName: "2026 Ruski Stat Sheet.xlsx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: buffer.byteLength
    });

    await expect(plugin.normalizeScorebook(parsed)).resolves.toMatchObject({
      tournament: {
        gameType: RUSKI_GAME_TYPE
      },
      validation: {
        valid: true
      }
    });
  });
});

function createEvent(id: string, type: string): GameEvent {
  return {
    id,
    type,
    matchId: "match-1",
    gameType: RUSKI_GAME_TYPE,
    sequence: Number(id.replace("event-", "")),
    playerId: "player-1",
    teamId: "team-1"
  };
}
