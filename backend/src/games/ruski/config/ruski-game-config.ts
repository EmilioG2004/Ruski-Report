import {
  RUSKI_GAME_TYPE,
  ruskiDisplayRules,
  ruskiGameDefinition,
  ruskiRulesMetadata,
  ruskiScorecardDefinition
} from "../definition";
import { ruskiScorebookSchema } from "../scorebook";
import { ruskiTournamentConfig } from "./ruski-tournament-config";

export const ruskiGameConfig = {
  gameType: RUSKI_GAME_TYPE,
  gameDefinition: ruskiGameDefinition,
  scorecardDefinition: ruskiScorecardDefinition,
  scorebookSchema: ruskiScorebookSchema,
  tournament: ruskiTournamentConfig,
  rules: ruskiRulesMetadata,
  displayRules: ruskiDisplayRules
};
