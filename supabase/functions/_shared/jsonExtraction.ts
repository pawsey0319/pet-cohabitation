function tryParseJson(value: string): unknown | undefined {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

function balancedJsonCandidates(value: string): string[] {
  const candidates: string[] = [];

  for (let start = 0; start < value.length; start += 1) {
    const opening = value[start];
    if (opening !== "{" && opening !== "[") continue;

    const stack: string[] = [opening];
    let inString = false;
    let escaping = false;

    for (let index = start + 1; index < value.length; index += 1) {
      const character = value[index];

      if (inString) {
        if (escaping) escaping = false;
        else if (character === "\\") escaping = true;
        else if (character === '"') inString = false;
        continue;
      }

      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === "{" || character === "[") stack.push(character);
      else if (character === "}" || character === "]") {
        const expected = character === "}" ? "{" : "[";
        if (stack.at(-1) !== expected) break;
        stack.pop();
        if (stack.length === 0) {
          candidates.push(value.slice(start, index + 1));
          break;
        }
      }
    }
  }

  return candidates;
}

/**
 * Extracts the first valid JSON value from an OpenAI-compatible model response.
 * Some compatible providers ignore response_format and wrap JSON in Markdown,
 * a reasoning preamble, or a short trailing explanation.
 */
export function extractJsonValue(content: string): unknown {
  const trimmed = content.trim();
  const direct = tryParseJson(trimmed);
  if (direct !== undefined) return direct;

  const fencedBlocks = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi)];
  for (const block of fencedBlocks) {
    const parsed = tryParseJson(block[1].trim());
    if (parsed !== undefined) return parsed;
  }

  for (const candidate of balancedJsonCandidates(trimmed)) {
    const parsed = tryParseJson(candidate);
    if (parsed !== undefined) return parsed;
  }

  throw new Error("text_model_invalid_json");
}
