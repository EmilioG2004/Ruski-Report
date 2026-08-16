import { Test } from "@nestjs/testing";

import { PublicApiModule } from "./public-api.module";

describe("PublicApiModule", () => {
  it("compiles with its concrete providers", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PublicApiModule]
    }).compile();

    await moduleRef.close();
  });
});
