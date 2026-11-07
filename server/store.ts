import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { chmodSync, closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export class Store {
  readonly db: DatabaseSync;

  constructor(filename = resolve('.local/vivacoach.sqlite')) {
    if (filename !== ':memory:') {
      mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
      closeSync(openSync(filename, 'a', 0o600));
      chmodSync(filename, 0o600);
    }
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000; PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS identities (
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL, expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS practices (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES identities(id),
        state_json TEXT NOT NULL, input_json TEXT NOT NULL,
        operation_kind TEXT, operation_token TEXT, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS answers (
        id TEXT PRIMARY KEY, practice_id TEXT NOT NULL REFERENCES practices(id) ON DELETE CASCADE,
        idempotency_key TEXT NOT NULL, question_id TEXT NOT NULL, answer TEXT NOT NULL,
        question_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL,
        UNIQUE(practice_id, idempotency_key), UNIQUE(practice_id, question_id)
      );
      CREATE INDEX IF NOT EXISTS practices_owner ON practices(owner_id, updated_at);
    `);
  }

  get<T>(sql: string, ...values: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...values) as T | undefined;
  }
  all<T>(sql: string, ...values: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...values) as T[];
  }
  run(sql: string, ...values: SQLInputValue[]) { return this.db.prepare(sql).run(...values); }
  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = operation(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  close() { this.db.close(); }
}
