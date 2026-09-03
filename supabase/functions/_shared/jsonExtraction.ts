function tryParseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function balancedJsonCandidates(value: string): string[] {
  const candidates: string[] = [];
  const stack: string[] = [];
  let start = -1;
  let inString = false;
  let escaping = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (start === -1) {
      if (character === "{" || character === "[") {
        start = index;
        stack.push(character);
      }
      continue;
    }
    if (inString) {
      if (escaping) escaping = false;
      else if (character === "\\") escaping = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{" || character === "[") stack.push(character);
    else if (character === "}" || character === "]") {
      const expected = character === "}" ? "{" : "[";
      if (stack.at(-1) !== expected) return candidates;
      stack.pop();
      if (!stack.length) {
        candidates.push(value.slice(start, index + 1));
        start = -1;
      }
    }
  }
  // An unclosed top-level document (and all of its nested values) is discarded.
  return candidates;
}

/**
 * Extracts the first valid JSON value from an OpenAI-compatible model response.
 * Some compatible providers ignore response_format and wrap JSON in Markdown,
 * a reasoning preamble, or a short trailing explanation.
 */
export function extractJsonValue(content: string): unknown {
  const values = extractJsonValues(content);
  if (values.length) return values[0];
  throw new Error("text_model_invalid_json");
}

export function extractJsonValues(content: string): unknown[] {
  const trimmed = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const direct = tryParseJson(trimmed);
  if (direct !== undefined) return [direct];

  const values: unknown[] = [];
  const seen = new Set<string>();
  const append = (raw: string) => {
    if (seen.has(raw)) return;
    seen.add(raw);
    const parsed = tryParseJson(raw);
    if (parsed !== undefined) values.push(parsed);
  };

  const fencedBlocks = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)];
  for (const block of fencedBlocks) {
    append(block[1].trim());
  }

  for (const candidate of balancedJsonCandidates(trimmed)) {
    append(candidate);
  }

  return values;
}

type ValidationResult<T> = { success: true; data: T } | { success: false };

export function parseStructuredModelContent<T>(
  content: string,
  finishReason: string | undefined,
  validate: (value: unknown) => ValidationResult<T>,
): T {
  if (finishReason === "length") throw new Error("text_model_output_truncated");
  if (finishReason === "content_filter") throw new Error("text_model_content_blocked");
  const candidates = extractJsonValues(content);
  for (const candidate of candidates) {
    const result = validate(candidate);
    if (result.success) return result.data;
  }
  throw new Error(candidates.length ? "text_model_invalid_structure" : "text_model_invalid_json");
}
