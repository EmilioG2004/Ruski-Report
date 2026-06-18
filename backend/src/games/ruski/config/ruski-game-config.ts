import {
  RUSKI_GAME_TYPE,
  ruskiDisplayRules,
  ruskiGameDefinition,
  ruskiRulesMetadata,
  ruskiScorecardDefinition
} from "../definition";
import { ruskiScorebookSchema } from "../scorebook";

export const ruskiGameConfig = {
  gameType: RUSKI_GAME_TYPE,
  gameDefinition: ruskiGameDefinition,
  scorecardDefinition: ruskiScorecardDefinition,
  scorebookSchema: ruskiScorebookSchema,
  rules: ruskiRulesMetadata,
  displayRules: ruskiDisplayRules
};
