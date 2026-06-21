import { ISODateTimeString, Metadata } from "../domain";

export const TRANSACTION_MANAGER = Symbol("TRANSACTION_MANAGER");

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
