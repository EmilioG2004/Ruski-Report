import { Test } from "@nestjs/testing";

import { AdminModule } from "./admin.module";

describe("AdminModule", () => {
  it("compiles with concrete upload providers", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AdminModule]
    }).compile();

    await moduleRef.close();
  });
});
