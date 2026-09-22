import { checkOrigin, getSession } from "@/lib/database";
import {
  MAX_ARCHIVE_BYTES,
  readCodeArchive,
  saveCodeArchive,
} from "@/lib/code-archive";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await getSession();
    const archive = await readCodeArchive(
      session.id,
      session.tables.map((table) => table.name),
    );
    if (new URL(request.url).searchParams.has("download") && archive)
      return new Response(Buffer.from(archive.data, "base64"), {
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(archive.info.name)}`,
          "Cache-Control": "no-store",
        },
      });
    return Response.json(
      { archive: archive?.info ?? null, databaseTables: session.tables.length },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return failure(error);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const session = await getSession();
    const length = Number(request.headers.get("content-length"));
    if (length > MAX_ARCHIVE_BYTES + 65536)
      throw new Error("El archivo supera 100 MB.");
    const form = await request.formData();
    const file = form.get("archive");
    if (!(file instanceof File) || file.size > MAX_ARCHIVE_BYTES)
      throw new Error("Sube un RAR o ZIP de hasta 100 MB.");
    const archive = await saveCodeArchive(
      session.id,
      new Uint8Array(await file.arrayBuffer()),
      file.name,
      session.tables.map((table) => table.name),
    );
    return Response.json({ archive, databaseTables: session.tables.length });
  } catch (error) {
    return failure(error);
  }
}
function failure(error: unknown) {
  return Response.json(
    {
      error:
        error instanceof Error
          ? error.message
          : "No se pudo guardar el código.",
    },
    { status: 400 },
  );
}
