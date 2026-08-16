import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown
} from "@nestjs/common";
import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

import { DatabaseConfig } from "../config/database.config";

export const DATABASE_CONFIG = Symbol("DATABASE_CONFIG");

@Injectable()
export class PostgresDatabase implements OnApplicationShutdown {
  private readonly logger = new Logger(PostgresDatabase.name);
  private readonly pool: Pool;

  constructor(@Inject(DATABASE_CONFIG) config: DatabaseConfig) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      ssl: config.ssl
        ? { rejectUnauthorized: config.sslRejectUnauthorized }
        : undefined,
      max: config.maxConnections,
      connectionTimeoutMillis: config.connectionTimeoutMilliseconds,
      idleTimeoutMillis: config.idleTimeoutMilliseconds
    });
    this.pool.on("error", (error) => {
      this.logger.error("PostgreSQL pool reported an idle client error.", error);
    });
  }

  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[]
  ): Promise<QueryResult<Row>> {
    return this.pool.query<Row>(text, values as unknown[] | undefined);
  }

  connect(): Promise<PoolClient> {
    return this.pool.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
