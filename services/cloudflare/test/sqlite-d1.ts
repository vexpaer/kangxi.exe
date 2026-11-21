import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/**
 * Wraps Node 24's built-in SQLite engine (`node:sqlite`) with the Cloudflare D1Database interface
 * so our Worker runs against the real 0001_init.sql schema and SQL queries in tests.
 */
export function createTestD1(): D1Database {
  const db = new DatabaseSync(":memory:");
  const migrationSql = fs.readFileSync(
    path.resolve(import.meta.dirname, "../migrations/0001_init.sql"),
    "utf8"
  );
  db.exec(migrationSql);

  const makeStmt = (sql: string, params: unknown[] = []) => {
    const normalize = (v: unknown) => (v === undefined ? null : v);
    const stmtApi = {
      bind(...args: unknown[]) {
        return makeStmt(sql, args.map(normalize));
      },
      async first<T = Record<string, unknown>>(col?: string): Promise<T | null> {
        const stmt = db.prepare(sql);
        const row = stmt.get(...(params as [])) as Record<string, unknown> | undefined;
        if (!row) return null;
        if (col) return (row[col] as T) ?? null;
        return row as T;
      },
      async all<T = Record<string, unknown>>() {
        const stmt = db.prepare(sql);
        const results = stmt.all(...(params as [])) as T[];
        return { results, success: true, meta: {} };
      },
      async run() {
        const stmt = db.prepare(sql);
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
    return stmtApi;
  };

  return {
    prepare(sql: string) {
      return makeStmt(sql) as unknown as D1PreparedStatement;
    },
    async batch(stmts: D1PreparedStatement[]) {
      const results = [];
      for (const s of stmts) {
        results.push(await s.run());
      }
      return results;
    },
    async exec(sql: string) {
      db.exec(sql);
      return { count: 1, duration: 0 };
    },
  } as unknown as D1Database;
}

export function createTestSyncHub() {
  const broadcasted: unknown[] = [];
  const kicked: string[] = [];

  const namespace = {
    idFromName(name: string) {
      return name as unknown as DurableObjectId;
    },
    get() {
      return {
        async fetch(input: RequestInfo | URL, init?: RequestInit) {
          const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
          if (url.endsWith("/broadcast") && init?.body) {
            broadcasted.push(JSON.parse(String(init.body)));
            return Response.json({ ok: true });
          }
          if (url.endsWith("/kick") && init?.body) {
            const parsed = JSON.parse(String(init.body)) as { credential_id: string };
            kicked.push(parsed.credential_id);
            return Response.json({ ok: true });
          }
          return new Response("OK");
        },
      };
    },
  } as unknown as DurableObjectNamespace;

  return { namespace, broadcasted, kicked };
}
