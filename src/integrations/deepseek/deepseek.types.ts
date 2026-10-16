/** Format chat completions DeepSeek (kompatibel OpenAI). */
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export type ChatMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type ToolChoice = 'required' | { type: 'function'; function: { name: string } };

export interface ChatRequest {
  messages: ChatMessage[];
  tools: ToolDefinition[];
  /** Default 'required': setiap giliran model wajib memanggil tool. */
  toolChoice?: ToolChoice;
}

export interface ChatResponse {
  choices: { message: { content: string | null; tool_calls?: ToolCall[] }; finish_reason: string }[];
}
