import { Metadata } from "../../domain";
import { RUSKI_EVENT_TYPE_IDS, RUSKI_STAT_KEYS } from "./ruski-ids";

export const ruskiRulesMetadata: Metadata = {
  teamSize: 2,
  startingCupCount: 10,
  ballsInPlay: 2,
  rerackCupCounts: [6, 3],
  drinkingTimeLimitSeconds: 60,
  overtime: {
    repeatable: true,
    startingCupCount: 6
  },
  specialMissEventTypeIds: [
    RUSKI_EVENT_TYPE_IDS.di,
    RUSKI_EVENT_TYPE_IDS.tri
  ]
};

export const ruskiDisplayRules: Metadata = {
  scorecard: {
    mirroredTeamSections: true,
    rowLabel: "Shot",
    participantLabel: "Teams",
    eventColumnOrder: [
      RUSKI_EVENT_TYPE_IDS.miss,
      RUSKI_EVENT_TYPE_IDS.make,
      RUSKI_EVENT_TYPE_IDS.splashOut,
      RUSKI_EVENT_TYPE_IDS.guy,
      RUSKI_EVENT_TYPE_IDS.tri,
      RUSKI_EVENT_TYPE_IDS.di,
      RUSKI_EVENT_TYPE_IDS.vom
    ],
    statOrder: [
      RUSKI_STAT_KEYS.makes,
      RUSKI_STAT_KEYS.misses,
      RUSKI_STAT_KEYS.shootingPercentage,
      RUSKI_STAT_KEYS.splashOuts,
      RUSKI_STAT_KEYS.guys,
      RUSKI_STAT_KEYS.tris,
      RUSKI_STAT_KEYS.dis,
      RUSKI_STAT_KEYS.voms
    ]
  }
};
