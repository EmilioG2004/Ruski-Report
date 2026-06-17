import { GameDefinition, ScorecardDefinition } from "../domain";

export const ruskiScorecardDefinition: ScorecardDefinition = {
  id: "ruski-scorecard",
  gameType: "ruski",
  name: "Ruski Scorecard",
  rowLabel: "Shot",
  columns: [
    {
      key: "shotNumber",
      label: "Shot",
      dataType: "number",
      required: true
    },
    {
      key: "result",
      label: "Result",
      dataType: "event",
      eventTypeIds: ["make", "miss", "di", "tri", "guy", "vom"]
    },
    {
      key: "cupCount",
      label: "Cups",
      dataType: "number"
    }
  ]
};

export const ruskiGameDefinition: GameDefinition = {
  gameType: "ruski",
  displayName: "Ruski",
  scorecardDefinitionId: ruskiScorecardDefinition.id,
  phases: [
    {
      id: "guy2guy",
      label: "Guy2Guy",
      sequence: 1
    },
    {
      id: "normal",
      label: "Normal Play",
      sequence: 2
    },
    {
      id: "redemption",
      label: "Redemption",
      sequence: 3
    },
    {
      id: "overtime",
      label: "Overtime",
      sequence: 4,
      isOvertime: true
    }
  ],
  eventTypes: [
    {
      id: "make",
      label: "Make",
      category: "score",
      affectsScore: true,
      countsAsAttempt: true,
      statKey: "makes"
    },
    {
      id: "miss",
      label: "Miss",
      category: "attempt",
      countsAsAttempt: true,
      statKey: "misses"
    },
    {
      id: "di",
      label: "Di",
      category: "attempt",
      countsAsAttempt: true,
      statKey: "dis",
      metadata: {
        countsAsMiss: true
      }
    },
    {
      id: "tri",
      label: "Tri",
      category: "attempt",
      countsAsAttempt: true,
      statKey: "tris",
      metadata: {
        countsAsMiss: true
      }
    },
    {
      id: "guy",
      label: "Guy",
      category: "attempt",
      countsAsAttempt: true,
      statKey: "guys"
    },
    {
      id: "vom",
      label: "Vom",
      category: "penalty",
      statKey: "voms"
    }
  ],
  stats: [
    {
      key: "makes",
      label: "Makes",
      scope: "player",
      valueType: "count"
    },
    {
      key: "misses",
      label: "Misses",
      scope: "player",
      valueType: "count"
    },
    {
      key: "shootingPercentage",
      label: "Shooting Percentage",
      shortLabel: "Shooting %",
      scope: "player",
      valueType: "percentage",
      precision: 3
    },
    {
      key: "dis",
      label: "Dis",
      scope: "player",
      valueType: "count"
    },
    {
      key: "tris",
      label: "Tris",
      scope: "player",
      valueType: "count"
    },
    {
      key: "guys",
      label: "Guys",
      scope: "player",
      valueType: "count"
    },
    {
      key: "voms",
      label: "Voms",
      scope: "player",
      valueType: "count"
    }
  ]
};
