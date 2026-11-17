import Anthropic from "@anthropic-ai/sdk";

/**
 * Narrow interface over the LLM so the agent can be tested with a fake and
 * swapped to another provider later. Every call returns structured JSON via a
 * forced tool call — no free-text parsing.
 */
export interface StructuredCall {
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  schema: Record<string, unknown>;
  maxTokens: number;
}

export interface StructuredResult<T> {
  data: T;
  inputTokens: number;
  outputTokens: number;
}

export interface ModelClient {
  readonly model: string;
  structured<T>(call: StructuredCall): Promise<StructuredResult<T>>;
}

export class AnthropicModelClient implements ModelClient {
  private client: Anthropic;
  constructor(
    readonly model: string = process.env.PONTE_MODEL || "claude-sonnet-5-5",
    apiKey: string | undefined = process.env.ANTHROPIC_API_KEY,
  ) {
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set. Copy .env.example to .env and add your key.");
    }
    this.client = new Anthropic({ apiKey, maxRetries: 3 });
  }

  async structured<T>(call: StructuredCall): Promise<StructuredResult<T>> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: call.maxTokens,
      system: call.system,
      tools: [
        {
          name: call.toolName,
          description: call.toolDescription,
          input_schema: call.schema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: call.toolName },
      messages: [{ role: "user", content: call.user }],
    });

    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      throw new Error(`Model did not return a ${call.toolName} tool call (stop_reason=${res.stop_reason}).`);
    }
    if (res.stop_reason === "max_tokens") {
      throw new Error(`Model output was cut off at max_tokens (${call.maxTokens}).`);
    }
    return {
      data: block.input as T,
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens,
    };
  }
}
