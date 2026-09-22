export type MainModelSettings = {
  apiKey: string;
  useCerebras?: boolean;
  cerebrasApiKey?: string;
};

export function mainModelRequest(
  settings: MainModelSettings & { model: string },
  messages: { role: string; content: string }[],
  freeVisualization: boolean,
) {
  // Some Cerebras chat templates accept a system message only at index zero,
  // even when multiple system messages are consecutive at the beginning.
  const systemMessages = messages.filter(
    (message) => message.role === "system",
  );
  const providerMessages =
    settings.useCerebras && systemMessages.length
      ? [
          {
            role: "system",
            content: systemMessages
              .map((message) => message.content)
              .join("\n\n"),
          },
          ...messages.filter((message) => message.role !== "system"),
        ]
      : messages;
  return {
    model: settings.model,
    temperature: 0,
    // Cerebras chooses the available completion budget for its model/context.
    // OpenRouter's large fixed budget can exceed Cerebras model limits.
    ...(settings.useCerebras
      ? {}
      : { max_tokens: freeVisualization ? 120000 : 30000 }),
    messages: providerMessages,
  };
}

export async function mainModelError(
  response: Response,
  provider: ReturnType<typeof mainModelProvider>,
) {
  let detail = "";
  try {
    const body = await response.json();
    const message = body?.error?.message ?? body?.message ?? body?.error;
    if (typeof message === "string") {
      detail = message;
      if (provider.apiKey)
        detail = detail.split(provider.apiKey).join("[oculta]");
      detail = detail.slice(0, 1500);
    }
  } catch {
    // Gateways may return HTML or an empty body instead of an API error.
  }
  return new Error(
    `La solicitud a ${provider.name} ha fallado (${response.status}). ${
      detail || "Revisa tu clave API, los créditos y el modelo en Conectar."
    }`,
  );
}

export function mainModelProvider(settings: MainModelSettings) {
  return settings.useCerebras
    ? {
        name: "Cerebras",
        url: "https://api.cerebras.ai/v1/chat/completions",
        apiKey: settings.cerebrasApiKey || "",
      }
    : {
        name: "OpenRouter",
        url: "https://openrouter.ai/api/v1/chat/completions",
        apiKey: settings.apiKey,
      };
}
