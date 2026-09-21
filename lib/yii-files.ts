import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { modelJson, type Analysis, type PhpSource } from "./yii-analysis.ts";

export const MAX_BYTES = 100 * 1024 * 1024;
const MAX_FILES = 20000;
export function readPhpArchive(data: Uint8Array): PhpSource[] {
  let bytes = 0,
    count = 0;
  const entries = unzipSync(data, {
    filter: (entry) => {
      if (!/\.php$/i.test(entry.name)) return false;
      bytes += entry.originalSize;
      if (++count > MAX_FILES || bytes > MAX_BYTES)
        throw new Error("El ZIP supera 20.000 PHP o 100 MB descomprimidos.");
      return true;
    },
  });
  return Object.entries(entries).map(([path, content]) => ({
    path,
    code: strFromU8(content),
  }));
}
export function exportYiiZip(analysis: Analysis): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  analysis.models.forEach((model, index) => {
    const name = `${String(index + 1).padStart(4, "0")}-${model.model.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    entries[`sin-codigo/${name}.json`] = strToU8(modelJson(model, false));
    entries[`con-codigo/${name}.json`] = strToU8(modelJson(model, true));
  });
  entries["informe.json"] = strToU8(
    JSON.stringify(
      {
        files: analysis.files,
        models: analysis.models.length,
        warnings: analysis.warnings,
        scope:
          "Análisis estático: referencias a clases y llamadas estáticas o $this a métodos incluidos. No resuelve SQL libre, reflexión, clases dinámicas, métodos de traits ni todos los flujos de variables. module conserva el nombre lógico sin el prefijo de conexión de Yii.",
      },
      null,
      2,
    ),
  );
  return zipSync(entries);
}
