import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is missing");
}

type ParsedDatabaseUrl = {
  host: string;
  port?: number;
  user?: string;
  password?: string;
  database: string;
  ssl?: boolean | "require" | "allow" | "prefer" | "verify-full";
};

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseDatabaseUrl(raw: string): ParsedDatabaseUrl {
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
  const password =
    firstColonInAuth >= 0 ? authPart.slice(firstColonInAuth + 1) : undefined;

  const queryIndex = databaseAndQueryPart.indexOf("?");
  const database =
    queryIndex >= 0 ? databaseAndQueryPart.slice(0, queryIndex) : databaseAndQueryPart;
  const query = queryIndex >= 0 ? databaseAndQueryPart.slice(queryIndex + 1) : "";

  const lastColonInHost = hostPortPart.lastIndexOf(":");
  const hasPort =
    lastColonInHost > 0 && !hostPortPart.includes("]"); // simple guard for non-IPv6 supabase hosts
  const host = hasPort ? hostPortPart.slice(0, lastColonInHost) : hostPortPart;
  const port = hasPort ? Number.parseInt(hostPortPart.slice(lastColonInHost + 1), 10) : undefined;

  if (!database) {
    throw new Error("DATABASE_URL database is missing");
  }

  const sslMatch = query
    .split("&")
    .find((item) => item.startsWith("sslmode="));
  const sslMode = sslMatch ? safeDecode(sslMatch.slice("sslmode=".length)) : undefined;

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

const credentials = parseDatabaseUrl(databaseUrl);

export default defineConfig({
  dialect: "postgresql",
  schema: "./db/schema.ts",
  out: "./drizzle",
  dbCredentials: credentials,
});
