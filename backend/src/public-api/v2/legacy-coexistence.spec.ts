import { PATH_METADATA } from "@nestjs/common/constants";

import { sampleTournament } from "../../sample-data";
import { MatchesController } from "../matches.controller";
import { TournamentsController } from "../tournaments.controller";
import { TournamentsService } from "../tournaments.service";
import { PublicV2Controller } from "./public-v2.controller";

describe("public API version coexistence", () => {
  it("keeps the legacy and v2 controller prefixes disjoint", () => {
    expect(Reflect.getMetadata(PATH_METADATA, TournamentsController)).toBe(
      "tournaments"
    );
    expect(Reflect.getMetadata(PATH_METADATA, MatchesController)).toBe("matches");
    expect(Reflect.getMetadata(PATH_METADATA, PublicV2Controller)).toBe("v2");
  });

  it("leaves the legacy active-tournament response unwrapped", async () => {
    const service = {
      getActiveTournament: jest.fn().mockResolvedValue(sampleTournament)
    } as unknown as TournamentsService;
    const controller = new TournamentsController(service);

    const response = await controller.getActiveTournament();

    expect(response).toBe(sampleTournament);
    expect(response).not.toHaveProperty("contractVersion");
    expect(response).not.toHaveProperty("projection");
  });
});
