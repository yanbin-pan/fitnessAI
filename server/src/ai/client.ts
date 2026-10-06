import type Anthropic from "@anthropic-ai/sdk";

// The coach's view of Claude. Only src/ai/ talks to the SDK; tests swap in a fake.

export type AiMessage = Anthropic.Beta.BetaMessageParam;
export type AiContentBlock = Anthropic.Beta.BetaContentBlock;
export type AiTool = Anthropic.Beta.BetaTool;

export type AiErrorCode = "timeout" | "rate_limited" | "api_error";

export class AiError extends Error {
  readonly code: AiErrorCode;

  constructor(code: AiErrorCode, message: string) {
    super(message);
    this.name = "AiError";
    this.code = code;
  }
}

export interface AiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export interface AiRequest {
  system: string;
  tools: AiTool[];
  messages: AiMessage[];
}

export interface AiResponse {
  content: AiContentBlock[];
  stop_reason: string | null;
  model: string;
  usage: AiUsage;
}

/** A one-off request whose answer must follow a JSON schema (structured outputs): the weekly insights. */
export interface AiStructuredRequest {
  system: string;
  prompt: string;
  /** A JSON schema the reply's text must match; every object closed (additionalProperties: false). */
  schema: Record<string, unknown>;
}

export interface AiClient {
  complete(request: AiRequest, signal: AbortSignal): Promise<AiResponse>;
  structured(request: AiStructuredRequest, signal: AbortSignal): Promise<AiResponse>;
}
