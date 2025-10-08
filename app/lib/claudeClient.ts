/**
 * Claude LLM Streaming Client
 *
 * A JavaScript client for communicating with the Claude API via Lambda streaming.
 * Supports both streaming and non-streaming responses.
 */

export interface StreamCallbacks {
  onChunk?: (text: string) => void;
  onComplete?: (usage: UsageStats) => void;
  onError?: (error: Error) => void;
}

export interface UsageStats {
  input_tokens: number;
  output_tokens: number;
}

export interface MessageOptions {
  model?: string;
  maxTokens?: number;
}

export interface ClientOptions {
  apiKey?: string;
  model?: string;
  maxTokens?: number;
}

export interface MessageResponse {
  text: string;
  model: string;
  usage: UsageStats;
}

/** Expected non-stream JSON shape from your API */
type ClaudeJSON = {
  response: string;
  model: string;
  usage: UsageStats;
};

/** Type guard to validate unknown JSON from response.json() */
function isClaudeJSON(x: unknown): x is ClaudeJSON {
  if (!x || typeof x !== "object") return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.response === "string" &&
    typeof o.model === "string" &&
    !!o.usage &&
    typeof (o.usage as any).input_tokens === "number" &&
    typeof (o.usage as any).output_tokens === "number"
  );
}

export class ClaudeLLMClient {
  private apiUrl: string;
  private apiKey: string | null;
  private defaultModel: string | null;
  private defaultMaxTokens: number;

  /**
   * Initialise the client
   * @param apiUrl - Lambda Function URL or Next.js API route
   * @param options - Optional configuration
   * @param options.apiKey - API key for authentication (passed as x-api-key header)
   * @param options.model - Override default model from parameters.json
   * @param options.maxTokens - Default max tokens (default: 4096)
   */
  constructor(apiUrl: string, options: ClientOptions = {}) {
    this.apiUrl = apiUrl;
    this.apiKey = options.apiKey || null;
    this.defaultModel = options.model || null; // Will use server default from parameters.json
    this.defaultMaxTokens = options.maxTokens ?? 4096;
  }

  /**
   * Send a message with streaming response
   * @param message - User message
   * @param callbacks - Callback functions for handling events
   * @param options - Optional parameters
   */
  async streamMessage(
    message: string,
    callbacks: StreamCallbacks = {},
    options: MessageOptions = {}
  ): Promise<void> {
    const { onChunk, onComplete, onError } = callbacks;

    try {
      const headers: HeadersInit = {
        "Content-Type": "application/json",
      };
      if (this.apiKey) headers["x-api-key"] = this.apiKey;

      const response = await fetch(this.apiUrl, {
        method: "POST",
        headers,
        body: JSON.stringify({
          message,
          stream: true,
          model: options.model ?? this.defaultModel,
          max_tokens: options.maxTokens ?? this.defaultMaxTokens,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Split by SSE event boundary
        const events = buffer.split("\n\n");
        buffer = events.pop() || ""; // keep incomplete fragment

        for (const ev of events) {
          const line = ev.trim();
          if (!line) continue;

          // Handle multiple "data:" lines if any; join payload lines
          const dataLines = line
            .split("\n")
            .filter((l) => l.startsWith("data: "))
            .map((l) => l.slice(6));
          if (dataLines.length === 0) continue;

          const joined = dataLines.join("");
          try {
            const data = JSON.parse(joined) as
              | { type: "chunk"; text: string }
              | { type: "done"; usage: UsageStats }
              | { type: "error"; error: string };

            if (data.type === "chunk") {
              onChunk?.(data.text);
            } else if (data.type === "done") {
              onComplete?.(data.usage);
            } else if (data.type === "error") {
              const err = new Error(data.error);
              if (onError) onError(err);
              else throw err;
            }
          } catch (e) {
            console.error("Failed to parse SSE data:", e);
          }
        }
      }
    } catch (error) {
      if (onError) onError(error as Error);
      else throw error;
    }
  }

  /**
   * Send a message with non-streaming response
   * @param message - User message
   * @param options - Optional parameters
   * @returns Response with text and usage stats
   */
  async sendMessage(
    message: string,
    options: MessageOptions = {}
  ): Promise<MessageResponse> {
    const headers: HeadersInit = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) headers["x-api-key"] = this.apiKey;

    const response = await fetch(this.apiUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message,
        stream: false,
        model: options.model ?? this.defaultModel,
        max_tokens: options.maxTokens ?? this.defaultMaxTokens,
      }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // TS 5.6+: json() is unknown — validate with a type guard
    const raw: unknown = await response.json();
    if (!isClaudeJSON(raw)) {
      console.error("Unexpected API payload:", raw);
      throw new Error("Invalid response format from Claude API");
    }

    return {
      text: raw.response,
      model: raw.model,
      usage: raw.usage,
    };
  }
}
