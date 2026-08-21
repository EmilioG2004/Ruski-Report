import { Module } from "@nestjs/common";

import { PostgresDatabase } from "../../database";
import { PersistenceModule } from "../../repositories";
import { PostgresPublicProjectionReadRepository } from "./postgres-public-projection-read.repository";
import { PUBLIC_PROJECTION_READ_REPOSITORY } from "./public-projection-read.repository";
import { PublicV2Controller } from "./public-v2.controller";
import { PublicV2Service } from "./public-v2.service";

@Module({
  imports: [PersistenceModule],
  controllers: [PublicV2Controller],
  providers: [
    PublicV2Service,
    {
      provide: PUBLIC_PROJECTION_READ_REPOSITORY,
      inject: [PostgresDatabase],
      useFactory: (database: PostgresDatabase) =>
        new PostgresPublicProjectionReadRepository(database)
    }
  ],
  exports: [PublicV2Service, PUBLIC_PROJECTION_READ_REPOSITORY]
})
export class PublicV2Module {}
