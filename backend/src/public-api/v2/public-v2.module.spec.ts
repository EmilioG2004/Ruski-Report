import { Test } from "@nestjs/testing";

import { PostgresPublicProjectionReadRepository } from "./postgres-public-projection-read.repository";
import { PUBLIC_PROJECTION_READ_REPOSITORY } from "./public-projection-read.repository";
import { PublicV2Module } from "./public-v2.module";

describe("PublicV2Module", () => {
  it("exports the canonical public match resolver for coexistence wiring", async () => {
    const module = await Test.createTestingModule({
      imports: [PublicV2Module]
    }).compile();

    expect(module.get(PUBLIC_PROJECTION_READ_REPOSITORY)).toBeInstanceOf(
      PostgresPublicProjectionReadRepository
    );

    await module.close();
  });
});
