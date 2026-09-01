import { HttpError } from "../middleware/error-handler";

const TOKEN_PATTERN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export function renderTemplate(body: string, payload: Record<string, unknown>): string {
  const required = new Set<string>();
  for (const match of body.matchAll(TOKEN_PATTERN)) {
    required.add(match[1]);
  }

  const missing = [...required].filter((key) => !(key in payload));
  if (missing.length > 0) {
    throw new HttpError(422, "Missing template payload keys", { missing });
  }

  return body.replace(TOKEN_PATTERN, (_raw, key: string) => String(payload[key]));
}
