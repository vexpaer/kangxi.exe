import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { SqlDatabase, SqlResult, SqlStatement } from "@kangxi/server-core";

export interface NodeSqliteHandle {
  db: SqlDatabase;
  raw: DatabaseSync;
  filePath: string;
  close: () => void;
}

/**
 * Opens a local SQLite database using Node's built-in `node:sqlite` (zero native compilation)
 * and wraps it in the portable `SqlDatabase` interface used by `@kangxi/server-core`.
 */
export function openNodeSqlite(filePath: string): NodeSqliteHandle {
  if (filePath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  }

  const raw = new DatabaseSync(filePath);
  if (filePath !== ":memory:") {
    raw.exec("PRAGMA journal_mode = WAL;");
  }
  raw.exec("PRAGMA busy_timeout = 5000;");
  raw.exec("PRAGMA foreign_keys = ON;");

  const makeStmt = (sql: string, params: unknown[] = []): SqlStatement => {
    const normalize = (v: unknown) => (v === undefined ? null : v);
    return {
      bind(...args: unknown[]) {
        return makeStmt(sql, args.map(normalize));
      },
      async first<T = Record<string, unknown>>(col?: string): Promise<T | null> {
        const stmt = raw.prepare(sql);
        const row = stmt.get(...(params as [])) as Record<string, unknown> | undefined;
        if (!row) return null;
        if (col) return (row[col] as T) ?? null;
        return row as T;
      },
      async all<T = Record<string, unknown>>(): Promise<SqlResult<T>> {
        const stmt = raw.prepare(sql);
        const results = stmt.all(...(params as [])) as T[];
        return { results, success: true, meta: {} };
      },
      async run(): Promise<SqlResult> {
        const stmt = raw.prepare(sql);
        const info = stmt.run(...(params as []));
        return {
          success: true,
          meta: {
            changes: Number(info.changes),
            last_row_id: Number(info.lastInsertRowid),
          },
          results: [],
        };
      },
    };
  };

  const db: SqlDatabase = {
    prepare(sql: string) {
      return makeStmt(sql);
    },
    async exec(sql: string) {
      raw.exec(sql);
    },
  };

  return {
    db,
    raw,
    filePath,
    close: () => raw.close(),
  };
}
