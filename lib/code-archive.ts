import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync, zipSync } from "fflate";
import { createExtractorFromData } from "node-unrar-js";
import {
  parseCodeModels,
  type CodeFunction,
  type CodeArchiveInfo,
} from "./code-context.ts";

export const MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
type SavedArchive = {
  info: CodeArchiveInfo;
  functions: CodeFunction[];
  data: string;
  tableNames: string[];
};
const directory = path.join(process.cwd(), ".datamatic", "code");
const location = (id: string) =>
  path.join(directory, `${createHash("sha256").update(id).digest("hex")}.json`);

export async function readCodeArchive(
  id: string,
  tables?: string[],
): Promise<SavedArchive | null> {
  try {
    const archive: SavedArchive = JSON.parse(
      await readFile(location(id), "utf8"),
    );
    // Older saves retained the entire upload. Migrate them on first access.
    if (
      tables &&
      (!archive.tableNames ||
        archive.tableNames.some((table) => !tables.includes(table)))
    ) {
      await saveCodeArchive(
        id,
        Buffer.from(archive.data, "base64"),
        archive.info.name,
        tables,
        archive.info,
      );
      return readCodeArchive(id);
    }
    return archive;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
export async function writeCodeArchive(id: string, archive: SavedArchive) {
  await mkdir(directory, { recursive: true });
  const temporary = `${location(id)}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(archive), { mode: 0o600 });
  await rename(temporary, location(id));
}

async function extractCodeArchive(data: Uint8Array, name: string) {
  if (!data.length || data.length > MAX_ARCHIVE_BYTES)
    throw new Error("El archivo debe contener entre 1 byte y 100 MB.");
  const include = (name: string) => {
    if (!/(^|\/)con-codigo\/[^/]+\.json$/i.test(name.replace(/\\/g, "/")))
      return false;
    return true;
  };
  let entries: Record<string, Uint8Array>;
  if (/\.zip$/i.test(name)) {
    entries = unzipSync(data, {
      filter: (entry) => include(entry.name),
    });
  } else if (/\.rar$/i.test(name)) {
    const extractor = await createExtractorFromData({
      data: Uint8Array.from(data).buffer,
    });
    const names = new Set<string>();
    // Exhaust both iterators to release the native decoder's allocations.
    for (const header of extractor.getFileList().fileHeaders) {
      if (!header.flags.directory && include(header.name))
        names.add(header.name);
    }
    entries = {};
    for (const file of extractor.extract({
      files: (header) => names.has(header.name),
    }).files) {
      if (file.extraction) entries[file.fileHeader.name] = file.extraction;
    }
  } else throw new Error("Sube un archivo .rar o .zip.");
  return entries;
}

export async function decodeCodeArchive(data: Uint8Array, name: string) {
  return parseCodeModels(await extractCodeArchive(data, name));
}

export async function saveCodeArchive(
  id: string,
  data: Uint8Array,
  name: string,
  tables: string[],
  previousInfo?: CodeArchiveInfo,
) {
  const entries = await extractCodeArchive(data, name);
  // Validate before replacing a saved archive, including code in omitted models.
  parseCodeModels(entries, previousInfo?.storedTables !== undefined);
  const databaseTables = new Set(tables);
  const jsonTables = new Set<string>();
  const storedTables = new Set<string>();
  const models = new Set<string>();
  const retained: Record<string, Uint8Array> = {};
  for (const [entry, bytes] of Object.entries(entries)) {
    const model = JSON.parse(
      new TextDecoder().decode(bytes).replace(/^\uFEFF/, ""),
    );
    if (model.module) jsonTables.add(model.module);
    if (!databaseTables.has(model.module)) continue;
    retained[entry] = bytes;
    storedTables.add(model.module);
    models.add(model.model);
  }
  const functions = parseCodeModels(retained, true);
  const info: CodeArchiveInfo = {
    name: path.basename(name).replace(/\.(rar|zip)$/i, ".zip"),
    savedAt: previousInfo?.savedAt ?? new Date().toISOString(),
    functions: functions.length,
    models: models.size,
    storedTables: storedTables.size,
    jsonTables: previousInfo?.jsonTables ?? jsonTables.size,
    jsonModels: previousInfo?.jsonModels ?? Object.keys(entries).length,
  };
  await writeCodeArchive(id, {
    info,
    functions,
    tableNames: [...storedTables],
    data: Buffer.from(zipSync(retained)).toString("base64"),
  });
  return info;
}
