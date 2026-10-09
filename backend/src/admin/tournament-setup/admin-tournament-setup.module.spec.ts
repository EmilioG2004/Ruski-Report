import { Test } from "@nestjs/testing";

import { AdminTournamentSetupModule } from "./admin-tournament-setup.module";

describe("AdminTournamentSetupModule", () => {
  it("compiles with persistence and administrator security providers", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AdminTournamentSetupModule]
    }).compile();

    await moduleRef.close();
  });
});
