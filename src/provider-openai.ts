import type {
  AgentMessage,
  AgentModel,
  AgentModelTurn,
  AgentToolCall,
  AgentToolDescriptor,
  MessageContent,
} from "./types.js";

interface OpenAICompatibleProviderOptions {
  baseUrl: string;
  apiKey?: string;
  model: string;
  temperature?: number;
  timeoutMs?: number;
}

interface ProviderToolCall {
  id?: string;
  type?: string;
  function?: {
    name?: string;
    arguments?: string;
  };
}

interface ProviderResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: ProviderToolCall[];
    };
  }>;
  error?: {
    message?: string;
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function mapMessage(message: AgentMessage): Record<string, unknown> {
  const mapped: Record<string, unknown> = {
    role: message.role,
    content: message.content,
  };

  if (message.name) mapped.name = message.name;
  if (message.toolCallId) mapped.tool_call_id = message.toolCallId;

  if (message.toolCalls?.length) {
    mapped.tool_calls = message.toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: {
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      },
    }));
  }

  return mapped;
}

function mapTool(tool: AgentToolDescriptor): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? {
        type: "object",
        properties: {},
        additionalProperties: true,
      },
    },
  };
}

function parseArguments(value: string | undefined): Record<string, unknown> {
  if (!value?.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { value: parsed };
    }
    return parsed as Record<string, unknown>;
  } catch {
    return { raw: value };
  }
}

function parseToolCalls(calls: ProviderToolCall[] | undefined): AgentToolCall[] {
  return (calls ?? [])
    .filter((call) => Boolean(call.function?.name))
    .map((call, index) => ({
      id: call.id ?? `tool-call-${index + 1}`,
      name: call.function?.name ?? "unknown_tool",
      arguments: parseArguments(call.function?.arguments),
    }));
}

export class OpenAICompatibleProvider implements AgentModel {
  private readonly baseUrl: string;
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly temperature: number;
  private readonly timeoutMs: number;

  constructor(options: OpenAICompatibleProviderOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.temperature = options.temperature ?? 0.2;
    this.timeoutMs = options.timeoutMs ?? 120_000;
  }

  async complete(input: {
    messages: AgentMessage[];
    tools: AgentToolDescriptor[];
  }): Promise<AgentModelTurn> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(this.apiKey
            ? { authorization: `Bearer ${this.apiKey}` }
            : {}),
        },
        body: JSON.stringify({
          model: this.model,
          messages: input.messages.map(mapMessage),
          tools: input.tools.length > 0 ? input.tools.map(mapTool) : undefined,
          tool_choice: input.tools.length > 0 ? "auto" : undefined,
          temperature: this.temperature,
        }),
        signal: controller.signal,
      });

      const payload = (await response.json()) as ProviderResponse;
      if (!response.ok) {
        throw new Error(
          payload.error?.message ??
            `Model request failed with HTTP ${response.status}`,
        );
      }

      const message = payload.choices?.[0]?.message;
      if (!message) throw new Error("Model response did not contain a message");

      const result: AgentModelTurn = {
        toolCalls: parseToolCalls(message.tool_calls),
      };
      if (message.content) result.content = message.content;
      return result;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function textContent(value: MessageContent): string {
  if (typeof value === "string") return value;
  return value
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
}
