import { analyzeYii, type PhpSource } from "../../lib/yii-analysis";
import { exportYiiZip, MAX_BYTES, readPhpArchive } from "../../lib/yii-files";

self.onmessage = async (event: MessageEvent<File[]>) => {
  try {
    const sources: PhpSource[] = [];
    let bytes = 0;
    for (const file of event.data) {
      if (!/\.(php|zip)$/i.test(file.name)) continue;
      if (file.size > MAX_BYTES)
        throw new Error("Cada archivo debe pesar menos de 100 MB.");
      const added = /\.zip$/i.test(file.name)
        ? readPhpArchive(new Uint8Array(await file.arrayBuffer())).map((s) => ({
            ...s,
            path: `${file.name}/${s.path}`,
          }))
        : [
            {
              path: file.webkitRelativePath || file.name,
              code: await file.text(),
            },
          ];
      for (const source of added) {
        bytes += new TextEncoder().encode(source.code).length;
        if (bytes > MAX_BYTES || sources.length >= 20000)
          throw new Error(
            "Selecciona hasta 20.000 PHP y 100 MB de código por análisis.",
          );
        sources.push(source);
      }
      self.postMessage({
        type: "progress",
        message: `Leyendo archivos: ${sources.length} PHP…`,
      });
    }
    if (!sources.length)
      throw new Error("No se encontraron archivos .php en la selección.");
    const result = analyzeYii(sources, (done) => {
      if (done % 25 === 0)
        self.postMessage({
          type: "progress",
          message: `Analizando ${done} de ${sources.length} PHP…`,
        });
    });
    self.postMessage({ type: "progress", message: "Preparando los JSON…" });
    const zip = exportYiiZip(result);
    self.postMessage({ type: "done", result, zip });
  } catch (error) {
    self.postMessage({
      type: "error",
      message:
        error instanceof Error
          ? error.message
          : "No se pudo analizar el proyecto.",
    });
  }
};
