import { GameType } from "../domain";
import { UnsupportedGameTypeError } from "./errors";
import { GamePlugin } from "./game-plugin";

export class GamePluginRegistry {
  private readonly pluginsByType: ReadonlyMap<GameType, GamePlugin>;

  constructor(plugins: readonly GamePlugin[]) {
    this.pluginsByType = new Map(
      plugins.map((plugin) => [plugin.gameType, plugin])
    );
  }

  listSupportedGameTypes(): GameType[] {
    return [...this.pluginsByType.keys()].sort();
  }

  has(gameType: GameType): boolean {
    return this.pluginsByType.has(gameType);
  }

  get(gameType: GameType): GamePlugin {
    const plugin = this.pluginsByType.get(gameType);

    if (plugin === undefined) {
      throw new UnsupportedGameTypeError(
        gameType,
        this.listSupportedGameTypes()
      );
    }

    return plugin;
  }
}
