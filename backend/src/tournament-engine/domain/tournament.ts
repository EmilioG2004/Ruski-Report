import { CopiedTournamentConfiguration } from "../configuration/types";
import { TournamentId } from "./ids";

export type TournamentLifecycle =
  | "draft_setup"
  | "setup_published"
  | "pod_play"
  | "seeding_review"
  | "playoffs"
  | "completed"
  | "archived";

export type TournamentVisibility = "private" | "public";

export interface CanonicalTournament {
  readonly id: TournamentId;
  readonly year: number;
  readonly name: string;
  readonly lifecycle: TournamentLifecycle;
  readonly visibility: TournamentVisibility;
  readonly configuration: CopiedTournamentConfiguration;
}

const activePublicLifecycles = new Set<TournamentLifecycle>([
  "setup_published",
  "pod_play",
  "seeding_review",
  "playoffs"
]);

export function isActivePublicTournament(
  tournament: Pick<CanonicalTournament, "lifecycle" | "visibility">
): boolean {
  return tournament.visibility === "public" &&
    activePublicLifecycles.has(tournament.lifecycle);
}
