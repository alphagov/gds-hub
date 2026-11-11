import { PgTransaction, type PgTransactionConfig } from "drizzle-orm/pg-core";
import type { Database, Transaction } from "../db/client.js";

/** What repositories run their queries on: the connection pool or an open transaction. */
export type Executor = Database | Transaction;

const READ_SNAPSHOT: PgTransactionConfig = {
  isolationLevel: "repeatable read",
  accessMode: "read only",
};

export function isTransaction(executor: Executor): executor is Transaction {
  return executor instanceof PgTransaction;
}

/**
 * Runs `work` in a transaction: a new one on the pool, or a savepoint inside
 * an open transaction. If `work` throws, only its own changes are rolled back,
 * so a caller inside a larger transaction can recover and carry on.
 */
export function runInTransaction<R>(
  executor: Executor,
  work: (tx: Transaction) => Promise<R>,
): Promise<R> {
  return isTransaction(executor) ? executor.transaction(work) : executor.transaction(work);
}

/**
 * Runs several reads against one consistent snapshot of the database. Inside
 * an open transaction the reads simply join it.
 */
export function runReadOnly<R>(
  executor: Executor,
  work: (reader: Executor) => Promise<R>,
): Promise<R> {
  if (isTransaction(executor)) return work(executor);
  return executor.transaction(work, READ_SNAPSHOT);
}
