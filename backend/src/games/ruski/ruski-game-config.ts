import { ruskiGameDefinition } from "./ruski-game-definition";
import { RUSKI_GAME_TYPE } from "./ruski-ids";
import { ruskiDisplayRules, ruskiRulesMetadata } from "./ruski-metadata";
import { ruskiScorecardDefinition } from "./ruski-scorecard-definition";

export const ruskiGameConfig = {
  gameType: RUSKI_GAME_TYPE,
  gameDefinition: ruskiGameDefinition,
  scorecardDefinition: ruskiScorecardDefinition,
  rules: ruskiRulesMetadata,
  displayRules: ruskiDisplayRules
};
