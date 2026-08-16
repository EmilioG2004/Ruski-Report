import {
  GameDefinition,
  GameEventType,
  GamePhaseDefinition
} from "../../../domain";
import {
  RUSKI_EVENT_TYPE_IDS,
  RUSKI_GAME_TYPE,
  RUSKI_PHASE_IDS,
  RUSKI_STAT_KEYS
} from "./ruski-ids";
import { ruskiDisplayRules, ruskiRulesMetadata } from "./ruski-metadata";
import { ruskiScorecardDefinition } from "./ruski-scorecard-definition";

const phases: GamePhaseDefinition[] = [
  {
    id: RUSKI_PHASE_IDS.guy2guy,
    label: "Guy2Guy",
    sequence: 1,
    metadata: {
      determinesFirstPossession: true
    }
  },
  {
    id: RUSKI_PHASE_IDS.normal,
    label: "Normal Play",
    sequence: 2,
    metadata: {
      startingCupCount: 10,
      rerackCupCounts: [6, 3]
    }
  },
  {
    id: RUSKI_PHASE_IDS.redemption,
    label: "Redemption",
    sequence: 3,
    metadata: {
      startsAfterFinalCup: true,
      continuesWhileShotsAreMade: true
    }
  },
  {
    id: RUSKI_PHASE_IDS.overtime,
    label: "Overtime",
    sequence: 4,
    isOvertime: true,
    metadata: {
      repeatable: true,
      startingCupCount: 6
    }
  }
];

const eventTypes: GameEventType[] = [
  {
    id: RUSKI_EVENT_TYPE_IDS.miss,
    label: "Miss",
    category: "attempt",
    countsAsAttempt: true,
    statKey: RUSKI_STAT_KEYS.misses,
    metadata: {
      countsAsMiss: true,
      countsAsMake: false,
      scorebookLabel: "Miss"
    }
  },
  {
    id: RUSKI_EVENT_TYPE_IDS.make,
    label: "Make",
    category: "score",
    affectsScore: true,
    countsAsAttempt: true,
    statKey: RUSKI_STAT_KEYS.makes,
    metadata: {
      countsAsMiss: false,
      countsAsMake: true,
      cupCount: 1,
      scorebookLabel: "Make"
    }
  },
  {
    id: RUSKI_EVENT_TYPE_IDS.splashOut,
    label: "Splash-Out",
    category: "attempt",
    countsAsAttempt: true,
    statKey: RUSKI_STAT_KEYS.splashOuts,
    metadata: {
      countsAsMiss: true,
      countsAsMake: false,
      scorebookLabel: "Splash-Out"
    }
  },
  {
    id: RUSKI_EVENT_TYPE_IDS.guy,
    label: "Guy",
    category: "attempt",
    countsAsAttempt: true,
    statKey: RUSKI_STAT_KEYS.guys,
    metadata: {
      countsAsMiss: true,
      countsAsMake: false,
      scorebookLabel: "Guy",
      nextShotPenalty: "nonDominantHand"
    }
  },
  {
    id: RUSKI_EVENT_TYPE_IDS.tri,
    label: "Tri",
    category: "attempt",
    countsAsAttempt: true,
    statKey: RUSKI_STAT_KEYS.tris,
    metadata: {
      countsAsMiss: true,
      countsAsMake: false,
      specialMiss: true,
      cupCount: 3,
      scorebookLabel: "Tri"
    }
  },
  {
    id: RUSKI_EVENT_TYPE_IDS.di,
    label: "Di",
    category: "attempt",
    countsAsAttempt: true,
    statKey: RUSKI_STAT_KEYS.dis,
    metadata: {
      countsAsMiss: true,
      countsAsMake: false,
      specialMiss: true,
      cupCount: 2,
      scorebookLabel: "Di"
    }
  },
  {
    id: RUSKI_EVENT_TYPE_IDS.vom,
    label: "Vom",
    category: "penalty",
    statKey: RUSKI_STAT_KEYS.voms,
    metadata: {
      forfeitsNextShot: true,
      scorebookLabel: "Vom"
    }
  }
];

export const ruskiGameDefinition: GameDefinition = {
  gameType: RUSKI_GAME_TYPE,
  displayName: "Ruski",
  scorecardDefinitionId: ruskiScorecardDefinition.id,
  phases,
  eventTypes,
  stats: [
    {
      key: RUSKI_STAT_KEYS.makes,
      label: "Cups Made",
      shortLabel: "Makes",
      scope: "player",
      valueType: "count"
    },
    {
      key: RUSKI_STAT_KEYS.misses,
      label: "Cups Missed",
      shortLabel: "Misses",
      scope: "player",
      valueType: "count"
    },
    {
      key: RUSKI_STAT_KEYS.shootingPercentage,
      label: "Shooting Percentage",
      shortLabel: "Shooting %",
      scope: "player",
      valueType: "percentage",
      precision: 3
    },
    {
      key: RUSKI_STAT_KEYS.splashOuts,
      label: "Splash-Out",
      scope: "player",
      valueType: "count"
    },
    {
      key: RUSKI_STAT_KEYS.guys,
      label: "Guy",
      scope: "player",
      valueType: "count"
    },
    {
      key: RUSKI_STAT_KEYS.tris,
      label: "Tri",
      scope: "player",
      valueType: "count"
    },
    {
      key: RUSKI_STAT_KEYS.dis,
      label: "Di",
      scope: "player",
      valueType: "count"
    },
    {
      key: RUSKI_STAT_KEYS.uns,
      label: "Un",
      scope: "player",
      valueType: "count",
      metadata: {
        sourceOnly: true,
        documentedInRules: false
      }
    },
    {
      key: RUSKI_STAT_KEYS.voms,
      label: "Vom",
      scope: "player",
      valueType: "count"
    }
  ],
  metadata: {
    rules: ruskiRulesMetadata,
    displayRules: ruskiDisplayRules
  }
};
