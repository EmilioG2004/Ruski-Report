import {
  BoxScore,
  GameDefinition,
  GameEvent,
  GameType
} from "../domain";
import { ParsedScorebook } from "./parsed-scorebook";
import { ScorebookFile } from "./scorebook-file";
import { TournamentSnapshot } from "./tournament-snapshot";
import { ValidationResult } from "./validation-result";

export interface GamePlugin {
  readonly gameType: GameType;

  loadDefinition(): GameDefinition;

  parseScorebook(file: ScorebookFile): Promise<ParsedScorebook>;

  validateScorebook(parsed: ParsedScorebook): ValidationResult;

  normalizeScorebook(parsed: ParsedScorebook): Promise<TournamentSnapshot>;

  calculateStats(events: GameEvent[]): BoxScore;
}
