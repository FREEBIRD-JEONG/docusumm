import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import postgres from "postgres";

dotenv.config({ path: ".env.local" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is missing");
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseDatabaseUrl(raw) {
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
const sql = postgres({
  host: credentials.host,
  ...(credentials.port ? { port: credentials.port } : {}),
  ...(credentials.user ? { user: credentials.user } : {}),
  ...(credentials.password ? { password: credentials.password } : {}),
  database: credentials.database,
  ...(credentials.ssl ? { ssl: credentials.ssl } : {}),
  max: 1,
  prepare: false,
});

const userId = randomUUID();
const marker = `crud-check-${Date.now()}`;
const email = `${marker}@local.invalid`;

try {
  console.log("[db:crud-check] start");
  await sql`select 1`;

  await sql.begin(async (tx) => {
    await tx`
      insert into users (id, email, credits)
      values (${userId}, ${email}, 3)
    `;

    const [createdSummary] = await tx`
      insert into summaries (user_id, source_type, original_content, summary_text, status)
      values (${userId}, 'text', ${marker}, null, 'pending')
      returning id, status
    `;

    if (!createdSummary?.id || createdSummary.status !== "pending") {
      throw new Error("Create verification failed");
    }

    const [selectedSummary] = await tx`
      select id, status
      from summaries
      where id = ${createdSummary.id}
      limit 1
    `;

    if (!selectedSummary?.id) {
      throw new Error("Read verification failed");
    }

    await tx`
      update summaries
      set status = 'completed', summary_text = 'CRUD smoke test summary'
      where id = ${createdSummary.id}
    `;

    const [updatedSummary] = await tx`
      select status, summary_text
      from summaries
      where id = ${createdSummary.id}
      limit 1
    `;

    if (updatedSummary?.status !== "completed") {
      throw new Error("Update verification failed");
    }

    await tx`delete from summaries where id = ${createdSummary.id}`;
    const [deletedCheck] = await tx`
      select id
      from summaries
      where id = ${createdSummary.id}
      limit 1
    `;
    if (deletedCheck?.id) {
      throw new Error("Delete verification failed");
    }

    await tx`delete from users where id = ${userId}`;
  });

  console.log("[db:crud-check] PASS");
} catch (error) {
  console.error("[db:crud-check] FAIL", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
