import { ScorebookCellAddress } from "../../scorebook-schema";

export interface RuskiStandingBlockLayout {
  podNameCell: ScorebookCellAddress;
  firstTeamRow: number;
  seedColumn: string;
  teamColumn: string;
  recordColumn: string;
  cupDifferentialColumn: string;
  shootingPercentageColumn: string;
}

export const ruskiStandingBlockLayouts: readonly RuskiStandingBlockLayout[] = [
  standingBlock("C2", 3, "B", "C", "D", "E", "F"),
  standingBlock("C8", 9, "B", "C", "D", "E", "F"),
  standingBlock("C14", 15, "B", "C", "D", "E", "F"),
  standingBlock("C20", 21, "B", "C", "D", "E", "F"),
  standingBlock("I2", 3, "H", "I", "J", "K", "L"),
  standingBlock("I8", 9, "H", "I", "J", "K", "L"),
  standingBlock("I14", 15, "H", "I", "J", "K", "L"),
  standingBlock("I20", 21, "H", "I", "J", "K", "L")
];

export interface RuskiBracketSlotLayout {
  teamCell: ScorebookCellAddress;
  winnerCell: ScorebookCellAddress;
  sourceMatchId?: string;
}

export interface RuskiBracketMatchLayout {
  id: string;
  sequence: number;
  slots: readonly [RuskiBracketSlotLayout, RuskiBracketSlotLayout];
}

export interface RuskiBracketRoundLayout {
  id: string;
  name: string;
  sequence: number;
  matches: readonly RuskiBracketMatchLayout[];
}

export const ruskiBracketRoundLayouts: readonly RuskiBracketRoundLayout[] = [
  {
    id: "sweet-16",
    name: "Sweet 16",
    sequence: 1,
    matches: [
      bracketMatch("sweet-16-1", 1, bracketSlot("C3", "B3"), bracketSlot("C4", "B4")),
      bracketMatch("sweet-16-2", 2, bracketSlot("C11", "B11"), bracketSlot("C12", "B12")),
      bracketMatch("sweet-16-3", 3, bracketSlot("C15", "B15"), bracketSlot("C16", "B16")),
      bracketMatch("sweet-16-4", 4, bracketSlot("C23", "B23"), bracketSlot("C24", "B24")),
      bracketMatch("sweet-16-5", 5, bracketSlot("S3", "T3"), bracketSlot("S4", "T4")),
      bracketMatch("sweet-16-6", 6, bracketSlot("S11", "T11"), bracketSlot("S12", "T12")),
      bracketMatch("sweet-16-7", 7, bracketSlot("S15", "T15"), bracketSlot("S16", "T16")),
      bracketMatch("sweet-16-8", 8, bracketSlot("S23", "T23"), bracketSlot("S24", "T24"))
    ]
  },
  {
    id: "elite-8",
    name: "Elite 8",
    sequence: 2,
    matches: [
      bracketMatch("elite-8-1", 1, bracketSlot("F7", "E7", "sweet-16-1"), bracketSlot("F8", "E8", "sweet-16-2")),
      bracketMatch("elite-8-2", 2, bracketSlot("F19", "E19", "sweet-16-3"), bracketSlot("F20", "E20", "sweet-16-4")),
      bracketMatch("elite-8-3", 3, bracketSlot("P7", "Q7", "sweet-16-5"), bracketSlot("P8", "Q8", "sweet-16-6")),
      bracketMatch("elite-8-4", 4, bracketSlot("P19", "Q19", "sweet-16-7"), bracketSlot("P20", "Q20", "sweet-16-8"))
    ]
  },
  {
    id: "final-4",
    name: "Final 4",
    sequence: 3,
    matches: [
      bracketMatch("final-4-1", 1, bracketSlot("I13", "H13", "elite-8-1"), bracketSlot("I14", "H14", "elite-8-2")),
      bracketMatch("final-4-2", 2, bracketSlot("M13", "N13", "elite-8-3"), bracketSlot("M14", "N14", "elite-8-4"))
    ]
  },
  {
    id: "championship",
    name: "Championship",
    sequence: 4,
    matches: [
      bracketMatch("championship-1", 1, bracketSlot("K10", "J10", "final-4-1"), bracketSlot("K11", "L11", "final-4-2"))
    ]
  }
];

export const ruskiChampionCell: ScorebookCellAddress = "K5";

function standingBlock(
  podNameCell: string,
  firstTeamRow: number,
  seedColumn: string,
  teamColumn: string,
  recordColumn: string,
  cupDifferentialColumn: string,
  shootingPercentageColumn: string
): RuskiStandingBlockLayout {
  return {
    podNameCell,
    firstTeamRow,
    seedColumn,
    teamColumn,
    recordColumn,
    cupDifferentialColumn,
    shootingPercentageColumn
  };
}

function bracketSlot(
  teamCell: string,
  winnerCell: string,
  sourceMatchId?: string
): RuskiBracketSlotLayout {
  return { teamCell, winnerCell, sourceMatchId };
}

function bracketMatch(
  id: string,
  sequence: number,
  first: RuskiBracketSlotLayout,
  second: RuskiBracketSlotLayout
): RuskiBracketMatchLayout {
  return { id, sequence, slots: [first, second] };
}
