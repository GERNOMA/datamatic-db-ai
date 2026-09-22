import "server-only";
import mysql from "mysql2/promise";
import { cookies } from "next/headers";
import type { Table } from "./types";
import type { DiscoveryContext } from "./jev";
import type { SelectedFunction } from "./code-context";

type Session = {
  url: string;
  apiKey: string;
  useCerebras?: boolean;
  cerebrasApiKey?: string;
  model: string;
  name: string;
  id: string;
  tables: Table[];
  expires: number;
  discoveries?: Map<string, DiscoveryContext>;
  codeContexts?: Map<string, SelectedFunction[]>;
};
// A small, single-server app: sessions expire after eight hours or a server restart.
const globalState = globalThis as typeof globalThis & {
  databaseSessions?: Map<string, Session>;
};
export const sessions = (globalState.databaseSessions ??= new Map<
  string,
  Session
>());

export async function getSession() {
  const token = (await cookies()).get("datamatic-session")?.value;
  const session = token ? sessions.get(token) : undefined;
  if (!session || session.expires < Date.now()) {
    if (token) sessions.delete(token);
    throw new Error(
      "Tu conexión ha caducado. Vuelve a conectarte en Conectar.",
    );
  }
  return session;
}

export async function openDatabase(connectionUrl: string) {
  const url = new URL(connectionUrl);
  if (url.protocol !== "mysql:" || !url.hostname || url.pathname.length < 2) {
    throw new Error(
      "Usa una URL de MySQL que incluya el nombre de la base de datos.",
    );
  }
  return mysql.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.slice(1)),
    ssl:
      url.searchParams.get("ssl") === "true"
        ? { rejectUnauthorized: true }
        : undefined,
    multipleStatements: false,
    connectTimeout: 10000,
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
  });
}

export { checkOrigin } from "./request-origin";
