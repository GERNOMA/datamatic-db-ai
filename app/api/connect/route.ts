import { randomUUID, createHash } from "node:crypto";
import { cookies } from "next/headers";
import type { RowDataPacket } from "mysql2";
import {
  checkOrigin,
  getSession,
  openDatabase,
  sessions,
} from "@/lib/database";
import type { Table } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  try {
    const session = await getSession();
    return Response.json({
      name: session.name,
      id: session.id,
      tables: session.tables,
      model: session.model,
      aiReady: !!session.apiKey,
    });
  } catch {
    return Response.json({ connected: false });
  }
}

export async function POST(request: Request) {
  let connection;
  try {
    checkOrigin(request);
    const body = await request.json();
    if (typeof body.url !== "string" || body.url.length > 4000)
      throw new Error("Introduce una URL de conexión MySQL válida.");
    connection = await openDatabase(body.url);
    const [columns] = await connection.query<RowDataPacket[]>(
      "SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, COLUMN_KEY, IS_NULLABLE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME, ORDINAL_POSITION",
    );
    const tables: Table[] = [];
    for (const column of columns) {
      let table = tables.find((t) => t.name === column.TABLE_NAME);
      if (!table) {
        table = { name: column.TABLE_NAME, fields: [] };
        tables.push(table);
      }
      table.fields.push({
        name: column.COLUMN_NAME,
        type: column.COLUMN_TYPE,
        key: column.COLUMN_KEY,
        nullable: column.IS_NULLABLE === "YES",
      });
    }
    const url = new URL(body.url);
    const name = decodeURIComponent(url.pathname.slice(1));
    const id = createHash("sha256")
      .update(`${url.host}/${name}/${url.username}`)
      .digest("hex")
      .slice(0, 20);
    const apiKey =
      typeof body.apiKey === "string"
        ? body.apiKey.trim() || process.env.OPENROUTER_API_KEY || ""
        : process.env.OPENROUTER_API_KEY || "";
    const model =
      typeof body.model === "string" && body.model.trim()
        ? body.model.trim()
        : process.env.OPENROUTER_MODEL || "openrouter/auto";
    const token = randomUUID();
    const cookieStore = await cookies();
    const old = cookieStore.get("datamatic-session")?.value;
    if (old) sessions.delete(old);
    for (const [key, session] of sessions)
      if (session.expires < Date.now()) sessions.delete(key);
    sessions.set(token, {
      url: body.url,
      name,
      id,
      tables,
      apiKey,
      model,
      expires: Date.now() + 8 * 60 * 60 * 1000,
    });
    cookieStore.set("datamatic-session", token, {
      httpOnly: true,
      sameSite: "strict",
      secure: new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: 8 * 60 * 60,
    });
    return Response.json({ name, id, tables, model, aiReady: !!apiKey });
  } catch {
    return Response.json(
      {
        error:
          "No se pudo conectar. Revisa la URL de MySQL, las credenciales, el acceso a la red y la configuración SSL (?ssl=true).",
      },
      { status: 400 },
    );
  } finally {
    await connection?.end();
  }
}

export async function DELETE(request: Request) {
  try {
    checkOrigin(request);
    const cookieStore = await cookies();
    const token = cookieStore.get("datamatic-session")?.value;
    if (token) sessions.delete(token);
    cookieStore.delete("datamatic-session");
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "No se pudo desconectar." }, { status: 400 });
  }
}
