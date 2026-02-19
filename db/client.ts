import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "@/db/schema";

type SqlClient = postgres.Sql<Record<string, never>>;
type DrizzleClient = PostgresJsDatabase<typeof schema>;
type ParsedDatabaseCredentials = {
  host: string;
  port?: number;
  user?: string;
  password?: string;
  database: string;
  ssl?: boolean | "require" | "allow" | "prefer" | "verify-full";
};

declare global {
  var __docusummSql__: SqlClient | undefined;
  var __docusummDb__: DrizzleClient | undefined;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseDatabaseUrl(raw: string): ParsedDatabaseCredentials {
  const protocolIndex = raw.indexOf("://");
  if (protocolIndex < 0) {
    throw new Error("DATABASE_URL must include protocol");
  }

  const withoutProtocol = raw.slice(protocolIndex + 3);
  const atIndex = withoutProtocol.lastIndexOf("@");
  if (atIndex < 0) {
    throw new Error("DATABASE_URL must include auth and host");
  }

  const authPart = withoutProtocol.slice(0, atIndex);
  const hostAndPathPart = withoutProtocol.slice(atIndex + 1);

  const slashIndex = hostAndPathPart.indexOf("/");
  if (slashIndex < 0) {
    throw new Error("DATABASE_URL must include database name");
  }

  const hostPortPart = hostAndPathPart.slice(0, slashIndex);
  const databaseAndQueryPart = hostAndPathPart.slice(slashIndex + 1);

  const firstColonInAuth = authPart.indexOf(":");
  const user =
    firstColonInAuth >= 0 ? safeDecode(authPart.slice(0, firstColonInAuth)) : safeDecode(authPart);
  const password = firstColonInAuth >= 0 ? authPart.slice(firstColonInAuth + 1) : undefined;

  const queryIndex = databaseAndQueryPart.indexOf("?");
  const database =
    queryIndex >= 0 ? databaseAndQueryPart.slice(0, queryIndex) : databaseAndQueryPart;
  const query = queryIndex >= 0 ? databaseAndQueryPart.slice(queryIndex + 1) : "";

  const lastColonInHost = hostPortPart.lastIndexOf(":");
  const hasPort = lastColonInHost > 0 && !hostPortPart.includes("]");
  const host = hasPort ? hostPortPart.slice(0, lastColonInHost) : hostPortPart;
  const port = hasPort ? Number.parseInt(hostPortPart.slice(lastColonInHost + 1), 10) : undefined;

  const sslMatch = query
    .split("&")
    .find((item) => item.startsWith("sslmode="));
  const sslMode = sslMatch ? safeDecode(sslMatch.slice("sslmode=".length)) : undefined;

  if (!database) {
    throw new Error("DATABASE_URL database is missing");
  }

  return {
    host,
    ...(Number.isFinite(port) ? { port } : {}),
    ...(user ? { user } : {}),
    ...(password ? { password } : {}),
    database: safeDecode(database),
    ...(sslMode
      ? {
          ssl:
            sslMode === "require" ||
            sslMode === "allow" ||
            sslMode === "prefer" ||
            sslMode === "verify-full"
              ? sslMode
              : true,
        }
      : {}),
  };
}

export function getSqlClient(): SqlClient | null {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return null;
  }

  if (!globalThis.__docusummSql__) {
    const credentials = parseDatabaseUrl(databaseUrl);

    globalThis.__docusummSql__ = postgres({
      host: credentials.host,
      ...(credentials.port ? { port: credentials.port } : {}),
      ...(credentials.user ? { user: credentials.user } : {}),
      ...(credentials.password ? { password: credentials.password } : {}),
      database: credentials.database,
      ...(credentials.ssl ? { ssl: credentials.ssl } : {}),
      max: 1,
      prepare: false,
      idle_timeout: 20,
    });
  }

  return globalThis.__docusummSql__;
}

export function getDb(): DrizzleClient | null {
  const sql = getSqlClient();
  if (!sql) {
    return null;
  }

  if (!globalThis.__docusummDb__) {
    globalThis.__docusummDb__ = drizzle(sql, { schema });
  }

  return globalThis.__docusummDb__;
}
