/**
 * tools/util.ts — shared helpers for MCP tool handlers.
 *
 * Every tool returns its result as JSON text content; every failure uses the
 * SPEC §6 error envelope `{ ok:false, error:{ code, message } }` and is flagged
 * with `isError: true` so MCP clients surface it as a tool error.
 */
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CodedError } from "../matches.js";
import { toolError } from "../contracts.js";

export function jsonContent(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

export function errorContent(code: string, message: string): CallToolResult {
  return { ...jsonContent(toolError(code, message)), isError: true };
}

/** Run a tool handler, converting thrown CodedErrors/unexpected errors to the SPEC envelope.
 *  If the handler already returns a CallToolResult it is passed through untouched. */
export async function guarded(fn: () => unknown | Promise<unknown>): Promise<CallToolResult> {
  try {
    const value = await fn();
    if (value && typeof value === "object" && Array.isArray((value as CallToolResult).content)) {
      return value as CallToolResult;
    }
    return jsonContent(value);
  } catch (err) {
    if (err instanceof CodedError) return errorContent(err.code, err.message);
    const message = err instanceof Error ? err.message : String(err);
    return errorContent("INTERNAL", message);
  }
}
