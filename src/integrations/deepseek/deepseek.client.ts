import { env } from '../../config/env.ts';
import type { ChatRequest, ChatResponse } from './deepseek.types.ts';

const CHAT_URL = 'https://api.deepseek.com/chat/completions';

export class DeepseekClient {
  get isConfigured() {
    return env.deepseekApiKey.length > 0;
  }

  async chat({ messages, tools, toolChoice = 'required' }: ChatRequest): Promise<ChatResponse['choices'][number]['message']> {
    if (!this.isConfigured) throw new Error('DEEPSEEK_API_KEY belum diset di .env');

    const res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.deepseekApiKey}` },
      // Thinking mode menolak tool_choice 'required'/fungsi paksa, jadi dimatikan agar loop agent tetap bisa memaksa tool call.
      body: JSON.stringify({
        model: env.deepseekModel,
        messages,
        tools,
        tool_choice: toolChoice,
        thinking: { type: 'disabled' },
        temperature: 0.2,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`DeepSeek HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as ChatResponse;
    const message = data.choices[0]?.message;
    if (!message) throw new Error('DeepSeek: response tanpa choices');
    return message;
  }
}
