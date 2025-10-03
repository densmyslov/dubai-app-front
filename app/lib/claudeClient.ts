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

export class ClaudeLLMClient {
  private apiUrl: string;
  private apiKey: string | null;
  private defaultModel: string | null;
  private defaultMaxTokens: number;

  /**
   * Initialize the client
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
    this.defaultMaxTokens = options.maxTokens || 4096;
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
        'Content-Type': 'application/json',
      };

      if (this.apiKey) {
        headers['x-api-key'] = this.apiKey;
      }

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: message,
          stream: true,
          model: options.model || this.defaultModel,
          max_tokens: options.maxTokens || this.defaultMaxTokens,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      // Read streaming response
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // Decode chunk and add to buffer
        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE events (separated by \n\n)
        const events = buffer.split('\n\n');

        // Keep incomplete event in buffer
        buffer = events.pop() || '';

        for (const event of events) {
          if (!event.trim()) continue;

          // Parse SSE format: "data: {...}"
          if (event.startsWith('data: ')) {
            try {
              const data = JSON.parse(event.substring(6));

              if (data.type === 'chunk' && onChunk) {
                onChunk(data.text);
              } else if (data.type === 'done' && onComplete) {
                onComplete(data.usage);
              } else if (data.type === 'error' && onError) {
                onError(new Error(data.error));
              }
            } catch (e) {
              console.error('Failed to parse SSE data:', e);
            }
          }
        }
      }
    } catch (error) {
      if (onError) {
        onError(error as Error);
      } else {
        throw error;
      }
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
    try {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };

      if (this.apiKey) {
        headers['x-api-key'] = this.apiKey;
      }

      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: message,
          stream: false,
          model: options.model || this.defaultModel,
          max_tokens: options.maxTokens || this.defaultMaxTokens,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return {
        text: data.response,
        model: data.model,
        usage: data.usage,
      };
    } catch (error) {
      throw error;
    }
  }
}
