import {
  BoxScore,
  GameDefinition,
  GameEvent
} from "../../../domain";
import { GamePlugin } from "../../game-plugin";
import { ParsedScorebook } from "../../parsed-scorebook";
import { ScorebookFile } from "../../scorebook-file";
import { TournamentSnapshot } from "../../tournament-snapshot";
import { ValidationResult } from "../../validation-result";
import {
  RUSKI_GAME_TYPE,
  ruskiGameDefinition
} from "../definition";
import {
  calculateRuskiBoxScore,
  RuskiScorebookNormalizer
} from "../normalizer";
import { RuskiScorebookParser } from "../parser";
import { RuskiScorebookValidator } from "../validator";

export class RuskiGamePlugin implements GamePlugin {
  readonly gameType = RUSKI_GAME_TYPE;

  constructor(
    private readonly parser = new RuskiScorebookParser(),
    private readonly validator = new RuskiScorebookValidator(),
    private readonly normalizer = new RuskiScorebookNormalizer(validator)
  ) {}

  loadDefinition(): GameDefinition {
    return ruskiGameDefinition;
  }

  parseScorebook(file: ScorebookFile): Promise<ParsedScorebook> {
    return this.parser.parseScorebook(file);
  }

  validateScorebook(parsed: ParsedScorebook): ValidationResult {
    return this.validator.validateScorebook(parsed);
  }

  normalizeScorebook(parsed: ParsedScorebook): Promise<TournamentSnapshot> {
    return this.normalizer.normalizeScorebook(parsed);
  }

  calculateStats(events: GameEvent[]): BoxScore {
    return calculateRuskiBoxScore(events[0]?.matchId ?? "unknown-match", events);
  }
}

export const ruskiGamePlugin = new RuskiGamePlugin();
