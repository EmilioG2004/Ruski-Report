import { Metadata, PlayerId } from "./common";

export interface Player {
  id: PlayerId;
  displayName: string;
  firstName?: string;
  lastName?: string;
  preferredName?: string;
  metadata?: Metadata;
}
