import { GameType } from "../domain";

export class UnsupportedGameTypeError extends Error {
  constructor(
    readonly gameType: GameType,
    readonly supportedGameTypes: readonly GameType[]
  ) {
    super(
      `Unsupported game type "${gameType}". Supported game types: ${formatSupportedGameTypes(
        supportedGameTypes
      )}.`
    );
    this.name = "UnsupportedGameTypeError";
  }
}

function formatSupportedGameTypes(gameTypes: readonly GameType[]): string {
  if (gameTypes.length === 0) {
    return "none";
  }

  return gameTypes.join(", ");
}
