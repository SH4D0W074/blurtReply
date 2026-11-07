import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { chmodSync, closeSync, mkdirSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export class Store {
  readonly db: DatabaseSync;

  constructor(filename = resolve('.local/pairwise.sqlite')) {
    if (filename !== ':memory:') {
      mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
      closeSync(openSync(filename, 'a', 0o600));
      chmodSync(filename, 0o600);
    }
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000; PRAGMA journal_mode = WAL;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL, expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY, owner_session_id TEXT NOT NULL REFERENCES sessions(id),
        lesson_id TEXT NOT NULL, title TEXT NOT NULL, mode TEXT NOT NULL,
        phase TEXT NOT NULL DEFAULT 'collecting', version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL, revealed INTEGER NOT NULL DEFAULT 0,
        ai_status TEXT NOT NULL, ai_message TEXT, analysis_token TEXT
      );
      CREATE TABLE IF NOT EXISTS participants (
        id TEXT PRIMARY KEY, room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        session_id TEXT REFERENCES sessions(id), alias TEXT NOT NULL,
        is_demo INTEGER NOT NULL DEFAULT 0, joined_at TEXT NOT NULL,
        UNIQUE(room_code, session_id), UNIQUE(room_code, alias)
      );
      CREATE TABLE IF NOT EXISTS responses (
        id TEXT PRIMARY KEY, room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
        stage TEXT NOT NULL, choice_id TEXT NOT NULL, reason TEXT NOT NULL,
        submitted_at TEXT NOT NULL, clarification TEXT, analysis_json TEXT,
        UNIQUE(participant_id, stage)
      );
      CREATE TABLE IF NOT EXISTS pairings (
        id TEXT PRIMARY KEY, room_code TEXT NOT NULL REFERENCES rooms(code) ON DELETE CASCADE,
        position INTEGER NOT NULL, data_json TEXT NOT NULL,
        UNIQUE(room_code, position)
      );
      CREATE INDEX IF NOT EXISTS participants_room ON participants(room_code);
      CREATE INDEX IF NOT EXISTS responses_room_stage ON responses(room_code, stage);
    `);
  }

  get<T>(sql: string, ...values: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...values) as T | undefined;
  }

  all<T>(sql: string, ...values: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...values) as T[];
  }

  run(sql: string, ...values: SQLInputValue[]) {
    return this.db.prepare(sql).run(...values);
  }

  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  close() { this.db.close(); }
}
