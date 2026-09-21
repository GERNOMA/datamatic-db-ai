import { importYiiZip } from "../../lib/yii-import";
self.onmessage = async (event: MessageEvent<File>) => {
  try {
    if (event.data.size > 100 * 1024 * 1024)
      throw new Error("El ZIP no puede superar 100 MB.");
    self.postMessage({
      result: importYiiZip(new Uint8Array(await event.data.arrayBuffer())),
    });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : "No se pudo leer el ZIP.",
    });
  }
};
