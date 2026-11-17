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
  /**
   * Optional: run many calls as one asynchronous batch (half price on Anthropic's API;
   * results usually within minutes, at most 24 hours). Returns a result or an Error per id.
   */
  batch?(
    calls: Array<{ id: string; call: StructuredCall }>,
    onProgress?: (msg: string) => void,
  ): Promise<Map<string, StructuredResult<unknown> | Error>>;
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

  private params(call: StructuredCall) {
    return {
      model: this.model,
      max_tokens: call.maxTokens,
      system: call.system,
      output_config: { format: { type: "json_schema" as const, schema: strictSchema(call.schema) as Record<string, unknown> } },
      messages: [{ role: "user" as const, content: `${call.user}\n\n(${call.toolDescription})` }],
    };
  }

  private parse<T>(res: Anthropic.Message, call: StructuredCall): StructuredResult<T> {
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

  private async viaOutputFormat<T>(call: StructuredCall): Promise<StructuredResult<T>> {
    return this.parse<T>(await this.client.messages.create(this.params(call)), call);
  }

  async batch(
    calls: Array<{ id: string; call: StructuredCall }>,
    onProgress: (msg: string) => void = () => {},
  ): Promise<Map<string, StructuredResult<unknown> | Error>> {
    const out = new Map<string, StructuredResult<unknown> | Error>();
    if (!calls.length) return out;
    const byId = new Map(calls.map((c) => [c.id, c.call]));
    const created = await this.client.messages.batches.create({
      requests: calls.map((c) => ({ custom_id: c.id, params: this.params(c.call) })),
    });
    onProgress(`batch ${created.id}: ${calls.length} request(s) submitted`);
    let batch = created;
    let wait = 15_000;
    while (batch.processing_status !== "ended") {
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 1.5, 60_000);
      batch = await this.client.messages.batches.retrieve(created.id);
      const c = batch.request_counts;
      onProgress(`batch ${batch.id}: ${c.succeeded} done, ${c.processing} processing, ${c.errored + c.expired + c.canceled} failed`);
    }
    for await (const item of await this.client.messages.batches.results(created.id)) {
      const call = byId.get(item.custom_id);
      if (!call) continue;
      if (item.result.type === "succeeded") {
        try {
          out.set(item.custom_id, this.parse(item.result.message, call));
        } catch (e) {
          out.set(item.custom_id, e instanceof Error ? e : new Error(String(e)));
        }
      } else {
        const why = item.result.type === "errored" ? JSON.stringify(item.result.error) : item.result.type;
        out.set(item.custom_id, new Error(`batch request ${item.result.type}: ${why}`));
      }
    }
    return out;
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
