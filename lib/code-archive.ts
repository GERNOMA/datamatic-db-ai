import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
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
};
const directory = path.join(process.cwd(), ".datamatic", "code");
const location = (id: string) =>
  path.join(directory, `${createHash("sha256").update(id).digest("hex")}.json`);

export async function readCodeArchive(
  id: string,
): Promise<SavedArchive | null> {
  try {
    return JSON.parse(await readFile(location(id), "utf8"));
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

export async function decodeCodeArchive(data: Uint8Array, name: string) {
  if (!data.length || data.length > MAX_ARCHIVE_BYTES)
    throw new Error("El archivo debe contener entre 1 byte y 100 MB.");
  let total = 0,
    count = 0;
  const include = (name: string, size: number) => {
    if (!/(^|\/)con-codigo\/[^/]+\.json$/i.test(name.replace(/\\/g, "/")))
      return false;
    total += size;
    //if (++count > 20000 || total > MAX_ARCHIVE_BYTES)
    //  throw new Error("El archivo supera 20.000 JSON o 100 MB descomprimidos.");
    return true;
  };
  let entries: Record<string, Uint8Array>;
  if (/\.zip$/i.test(name)) {
    entries = unzipSync(data, {
      filter: (entry) => include(entry.name, entry.originalSize),
    });
  } else if (/\.rar$/i.test(name)) {
    const extractor = await createExtractorFromData({
      data: Uint8Array.from(data).buffer,
    });
    const names = new Set<string>();
    // Exhaust both iterators to release the native decoder's allocations.
    for (const header of extractor.getFileList().fileHeaders) {
      if (!header.flags.directory && include(header.name, header.unpSize))
        names.add(header.name);
    }
    entries = {};
    for (const file of extractor.extract({
      files: (header) => names.has(header.name),
    }).files) {
      if (file.extraction) entries[file.fileHeader.name] = file.extraction;
    }
  } else throw new Error("Sube un archivo .rar o .zip.");
  return parseCodeModels(entries);
}

export async function saveCodeArchive(
  id: string,
  data: Uint8Array,
  name: string,
) {
  const functions = await decodeCodeArchive(data, name);
  const info: CodeArchiveInfo = {
    name: path.basename(name),
    savedAt: new Date().toISOString(),
    functions: functions.length,
    models: new Set(functions.flatMap((fn) => fn.models)).size,
  };
  await writeCodeArchive(id, {
    info,
    functions,
    data: Buffer.from(data).toString("base64"),
  });
  return info;
}
