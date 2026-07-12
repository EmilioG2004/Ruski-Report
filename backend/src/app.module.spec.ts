import { Test } from "@nestjs/testing";

import { AppModule } from "./app.module";

describe("AppModule", () => {
  it("compiles with HTTP and realtime modules", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    }).compile();

    await moduleRef.close();
  });
});
