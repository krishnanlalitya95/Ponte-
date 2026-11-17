import Anthropic from "@anthropic-ai/sdk";

/**
 * Narrow interface over the LLM so the agent can be tested with a fake and
 * swapped to another provider later. Every call returns JSON that matches a schema.
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

/**
 * Make a JSON schema acceptable to structured outputs: every object closed
 * (additionalProperties: false) with all properties required, and no numeric or
 * length constraints, which structured outputs don't accept.
 */
export function strictSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(strictSchema);
  if (!schema || typeof schema !== "object") return schema;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
    if (["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength", "minItems", "maxItems", "pattern", "format"].includes(k)) continue;
    out[k] = k === "properties" ? Object.fromEntries(Object.entries(v as object).map(([p, s]) => [p, strictSchema(s)])) : strictSchema(v);
  }
  if (out.type === "object" && out.properties) {
    out.additionalProperties = false;
    out.required = Object.keys(out.properties as object);
  }
  return out;
}

export class AnthropicModelClient implements ModelClient {
  private client: Anthropic;
  /** Set when the model rejects structured outputs; we then fall back to a tool call. */
  private useToolFallback = false;

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
    if (!this.useToolFallback) {
      try {
        return await this.viaOutputFormat<T>(call);
      } catch (e) {
        // Older models without structured outputs: remember and use a tool call instead.
        if (e instanceof Anthropic.BadRequestError && /output_config|output_format|structured|json_schema/i.test(e.message)) {
          this.useToolFallback = true;
        } else throw e;
      }
    }
    return this.viaTool<T>(call);
  }

  private async viaOutputFormat<T>(call: StructuredCall): Promise<StructuredResult<T>> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: call.maxTokens,
      system: call.system,
      output_config: { format: { type: "json_schema", schema: strictSchema(call.schema) as Record<string, unknown> } },
      messages: [{ role: "user", content: `${call.user}\n\n(${call.toolDescription})` }],
    });
    if (res.stop_reason === "max_tokens") throw new Error(`Model output was cut off at max_tokens (${call.maxTokens}).`);
    if (res.stop_reason === "refusal") throw new Error("The model declined this request.");
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("");
    let data: T;
    try {
      data = JSON.parse(text) as T;
    } catch {
      throw new Error(`Model returned invalid JSON (stop_reason=${res.stop_reason}).`);
    }
    return { data, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
  }

  private async viaTool<T>(call: StructuredCall): Promise<StructuredResult<T>> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: call.maxTokens,
      system: `${call.system}\n\nAlways answer by calling the ${call.toolName} tool exactly once.`,
      tools: [{ name: call.toolName, description: call.toolDescription, input_schema: call.schema as Anthropic.Tool.InputSchema }],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: call.user }],
    });
    if (res.stop_reason === "max_tokens") throw new Error(`Model output was cut off at max_tokens (${call.maxTokens}).`);
    const block = res.content.find((b) => b.type === "tool_use");
    if (!block || block.type !== "tool_use") {
      throw new Error(`Model did not call ${call.toolName} (stop_reason=${res.stop_reason}).`);
    }
    return { data: block.input as T, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
  }
}
