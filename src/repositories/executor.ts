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
 * Runs several reads against one consistent snapshot of the database, in a
 * new read-only REPEATABLE READ transaction. It always starts its own
 * transaction: an open one may be READ COMMITTED, where each statement can
 * see different committed data, and its isolation can't be raised once it
 * has run a query.
 */
export function runReadOnly<R>(
  db: Database,
  work: (reader: Transaction) => Promise<R>,
): Promise<R> {
  return db.transaction(work, READ_SNAPSHOT);
}
