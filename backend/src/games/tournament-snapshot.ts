import {
  GameDefinition,
  ISODateTimeString,
  MatchDetail,
  Tournament
} from "../domain";
import { ScorebookSource } from "./parsed-scorebook";
import { ValidationResult } from "./validation-result";

export interface TournamentSnapshot {
  tournament: Tournament;
  matches: MatchDetail[];
  gameDefinition: GameDefinition;
  source: ScorebookSource;
  validation: ValidationResult;
  generatedAt: ISODateTimeString;
}
