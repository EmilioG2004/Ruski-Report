import { Test } from "@nestjs/testing";

import { AdminWebModule } from "./admin-web.module";

describe("AdminWebModule", () => {
  it("compiles with administrator security and tournament setup providers", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AdminWebModule]
    }).compile();

    await moduleRef.close();
  });
});
