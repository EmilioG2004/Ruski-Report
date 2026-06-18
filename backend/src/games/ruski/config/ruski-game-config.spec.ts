import {
  RUSKI_EVENT_TYPE_IDS,
  RUSKI_PHASE_IDS
} from "../definition";
import { ruskiGameConfig } from "./ruski-game-config";

describe("Ruski game config", () => {
  it("defines the required Ruski event types", () => {
    const eventTypeIds = ruskiGameConfig.gameDefinition.eventTypes.map(
      (eventType) => eventType.id
    );

    expect(eventTypeIds).toEqual(
      expect.arrayContaining([
        RUSKI_EVENT_TYPE_IDS.miss,
        RUSKI_EVENT_TYPE_IDS.make,
        RUSKI_EVENT_TYPE_IDS.splashOut,
        RUSKI_EVENT_TYPE_IDS.guy,
        RUSKI_EVENT_TYPE_IDS.tri,
        RUSKI_EVENT_TYPE_IDS.di,
        RUSKI_EVENT_TYPE_IDS.vom
      ])
    );
  });

  it("defines redemption and repeatable overtime phases", () => {
    const phaseById = new Map(
      ruskiGameConfig.gameDefinition.phases.map((phase) => [phase.id, phase])
    );

    expect(phaseById.get(RUSKI_PHASE_IDS.redemption)).toMatchObject({
      label: "Redemption",
      metadata: {
        startsAfterFinalCup: true,
        continuesWhileShotsAreMade: true
      }
    });
    expect(phaseById.get(RUSKI_PHASE_IDS.overtime)).toMatchObject({
      label: "Overtime",
      isOvertime: true,
      metadata: {
        repeatable: true,
        startingCupCount: 6
      }
    });
  });

  it("documents di and tri as special misses", () => {
    const eventTypeById = new Map(
      ruskiGameConfig.gameDefinition.eventTypes.map((eventType) => [
        eventType.id,
        eventType
      ])
    );

    expect(eventTypeById.get(RUSKI_EVENT_TYPE_IDS.di)).toMatchObject({
      countsAsAttempt: true,
      metadata: {
        countsAsMiss: true,
        countsAsMake: false,
        specialMiss: true,
        cupCount: 2
      }
    });
    expect(eventTypeById.get(RUSKI_EVENT_TYPE_IDS.tri)).toMatchObject({
      countsAsAttempt: true,
      metadata: {
        countsAsMiss: true,
        countsAsMake: false,
        specialMiss: true,
        cupCount: 3
      }
    });
  });

  it("derives scorecard UI labels from the official scorecard config", () => {
    const labels = ruskiGameConfig.scorecardDefinition.columns.map(
      (column) => column.label
    );

    expect(labels).toEqual([
      "Shot",
      "Shooter",
      "Miss",
      "Make",
      "Splash-Out",
      "Guy",
      "Tri",
      "Di",
      "Vom"
    ]);
  });

  it("keeps scorecard event columns tied to known event types", () => {
    const eventTypeIds = new Set(
      ruskiGameConfig.gameDefinition.eventTypes.map((eventType) => eventType.id)
    );
    const scorecardEventTypeIds = ruskiGameConfig.scorecardDefinition.columns
      .flatMap((column) => column.eventTypeIds ?? [])
      .sort();

    expect(
      scorecardEventTypeIds.every((eventTypeId) => eventTypeIds.has(eventTypeId))
    ).toBe(true);
    expect(scorecardEventTypeIds).toEqual(
      [
        RUSKI_EVENT_TYPE_IDS.di,
        RUSKI_EVENT_TYPE_IDS.guy,
        RUSKI_EVENT_TYPE_IDS.make,
        RUSKI_EVENT_TYPE_IDS.miss,
        RUSKI_EVENT_TYPE_IDS.splashOut,
        RUSKI_EVENT_TYPE_IDS.tri,
        RUSKI_EVENT_TYPE_IDS.vom
      ].sort()
    );
  });
});
