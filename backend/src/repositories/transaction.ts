import { ISODateTimeString, Metadata } from "../domain";

export interface TransactionContext {
  id: string;
  startedAt: ISODateTimeString;
  metadata?: Metadata;
}

export interface TransactionManager {
  runInTransaction<T>(
    operation: (transaction: TransactionContext) => Promise<T>
  ): Promise<T>;
}
