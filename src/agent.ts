// ============================================================
// kalit-code-core — Agent runtime (shared by CLI + desktop)
// ============================================================
// The single source of truth for "run the Claude Agent SDK loop
// pointed at a kalit-model-server gateway". Both front-ends import
// this; neither duplicates it.
//
// Runs wherever there is full Node access (CLI process / Electron
// MAIN process) — never a sandboxed renderer.

// The SDK is ESM-only; load it lazily via dynamic import so this module
// works from both ESM (CLI/tsx) and CommonJS (Electron main) consumers.
type QueryFn = (args: { prompt: string; options: Record<string, unknown> }) => AsyncIterable<Record<string, unknown>>;
let queryFn: QueryFn | null = null;
async function getQuery(): Promise<QueryFn> {
  if (!queryFn) {
    const sdk = await import('@anthropic-ai/claude-agent-sdk');
    queryFn = sdk.query as unknown as QueryFn;
  }
  return queryFn;
}

/** Default context window used to compute the "% context used" gauge when a
 *  provider doesn't advertise one. Override per-config. */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

export interface AgentConfig {
  serverUrl: string;
  token: string;
  model: string;
  cwd: string;
  permissionMode: 'bypassPermissions' | 'acceptEdits' | 'default' | 'plan';
  appendSystemPrompt?: string;
  /** Token budget the model can hold before Claude Code auto-compacts. */
  contextWindow?: number;
}

export interface ContextUsage {
  /** Tokens currently occupying the context window (input + cached prefix). */
  tokens: number;
  /** The window those tokens are measured against. */
  window: number;
  /** 0–100, clamped. How full the context is before auto-compaction. */
  percent: number;
}

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool'; name: string; input: unknown }
  | { type: 'result'; sessionId: string; isError: boolean; text: string; context: ContextUsage }
  | { type: 'error'; message: string };

export interface TurnOptions {
  resumeSessionId?: string;
  abortController?: AbortController;
}

function applyEnv(cfg: AgentConfig): void {
  process.env.ANTHROPIC_BASE_URL = cfg.serverUrl;
  process.env.ANTHROPIC_AUTH_TOKEN = cfg.token;
  process.env.ANTHROPIC_API_KEY = cfg.token;
  delete (process.env as Record<string, unknown>).CLAUDECODE;
}

/** Pull the context footprint (full prompt size sent on the last turn) from a
 *  result message's usage block. */
function contextFromResult(m: Record<string, unknown>, window: number): ContextUsage {
  const u = (m.usage ?? {}) as Record<string, number>;
  const tokens =
    (u.input_tokens ?? 0) +
    (u.cache_read_input_tokens ?? 0) +
    (u.cache_creation_input_tokens ?? 0);
  const percent = window > 0 ? Math.min(100, Math.round((tokens / window) * 100)) : 0;
  return { tokens, window, percent };
}

/** Run one agent turn, yielding streaming text/thinking/tool events plus a
 *  final result carrying context usage. */
export async function* runTurn(
  prompt: string,
  cfg: AgentConfig,
  opts: TurnOptions = {},
): AsyncGenerator<AgentEvent> {
  applyEnv(cfg);
  const query = await getQuery();
  const window = cfg.contextWindow ?? DEFAULT_CONTEXT_WINDOW;

  try {
    for await (const message of query({
      prompt,
      options: {
        model: cfg.model,
        cwd: cfg.cwd,
        permissionMode: cfg.permissionMode,
        systemPrompt: { type: 'preset', preset: 'claude_code', append: cfg.appendSystemPrompt },
        includePartialMessages: true,
        resume: opts.resumeSessionId,
        abortController: opts.abortController,
      },
    })) {
      const m = message as Record<string, unknown>;

      if (m.type === 'stream_event') {
        const ev = (m as { event?: { type?: string; delta?: { type?: string; text?: string; thinking?: string } } }).event;
        if (ev?.type === 'content_block_delta') {
          const d = ev.delta || {};
          if (d.type === 'text_delta' && typeof d.text === 'string') yield { type: 'text', text: d.text };
          else if (d.type === 'thinking_delta' && typeof d.thinking === 'string') yield { type: 'thinking', text: d.thinking };
        }
        continue;
      }

      if (m.type === 'assistant') {
        const content = (m as { message?: { content?: Array<Record<string, unknown>> } }).message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'tool_use') yield { type: 'tool', name: String(block.name), input: block.input };
          }
        }
      } else if (m.type === 'result') {
        yield {
          type: 'result',
          sessionId: String(m.session_id || ''),
          isError: m.subtype !== 'success',
          text: typeof m.result === 'string' ? m.result : '',
          context: contextFromResult(m, window),
        };
      }
    }
  } catch (err) {
    yield { type: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
