import { ScorecardColumnDefinition, ScorecardDefinition } from "../../domain";
import {
  RUSKI_EVENT_TYPE_IDS,
  RUSKI_GAME_TYPE,
  RUSKI_STAT_KEYS
} from "./ruski-ids";

const eventFlagColumns: ScorecardColumnDefinition[] = [
  {
    key: "miss",
    label: "Miss",
    dataType: "boolean",
    eventTypeIds: [RUSKI_EVENT_TYPE_IDS.miss],
    statKey: RUSKI_STAT_KEYS.misses
  },
  {
    key: "make",
    label: "Make",
    dataType: "boolean",
    eventTypeIds: [RUSKI_EVENT_TYPE_IDS.make],
    statKey: RUSKI_STAT_KEYS.makes
  },
  {
    key: "splashOut",
    label: "Splash-Out",
    dataType: "boolean",
    eventTypeIds: [RUSKI_EVENT_TYPE_IDS.splashOut],
    statKey: RUSKI_STAT_KEYS.splashOuts
  },
  {
    key: "guy",
    label: "Guy",
    dataType: "boolean",
    eventTypeIds: [RUSKI_EVENT_TYPE_IDS.guy],
    statKey: RUSKI_STAT_KEYS.guys
  },
  {
    key: "tri",
    label: "Tri",
    dataType: "boolean",
    eventTypeIds: [RUSKI_EVENT_TYPE_IDS.tri],
    statKey: RUSKI_STAT_KEYS.tris
  },
  {
    key: "di",
    label: "Di",
    dataType: "boolean",
    eventTypeIds: [RUSKI_EVENT_TYPE_IDS.di],
    statKey: RUSKI_STAT_KEYS.dis
  },
  {
    key: "vom",
    label: "Vom",
    dataType: "boolean",
    eventTypeIds: [RUSKI_EVENT_TYPE_IDS.vom],
    statKey: RUSKI_STAT_KEYS.voms
  }
];

export const ruskiScorecardDefinition: ScorecardDefinition = {
  id: "ruski-scorecard",
  gameType: RUSKI_GAME_TYPE,
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
      key: "shooter",
      label: "Shooter",
      dataType: "player",
      required: true
    },
    ...eventFlagColumns
  ],
  metadata: {
    source: "official-ruski-scorebook",
    mirroredTeamSections: true,
    scorebookHeaders: [
      "Shot",
      "Shooter",
      "Miss",
      "Make",
      "Splash-Out",
      "Guy",
      "Tri",
      "Di",
      "Vom"
    ]
  }
};
