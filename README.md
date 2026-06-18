# kalit-code-core

The **shared agent engine** behind the kalit-code front-ends. It wraps the Claude
Agent SDK `query()` loop, points it at a [`kalit-model-server`](../kalit-model-server)
gateway via `ANTHROPIC_BASE_URL`, and streams normalized events. Both
[`kalit-code-cli`](../kalit-code-cli) and [`kalit-code-desktop`](../kalit-code-desktop)
import this — so the agent logic lives in exactly one place.

```
kalit-code-cli ─┐
                ├─► kalit-code-core ──► kalit-model-server ──► Ollama / Kimi / …
kalit-code-desktop ─┘
```

## API

```ts
import { runTurn, fetchModels, checkServer, type AgentConfig } from 'kalit-code-core';

const cfg: AgentConfig = {
  serverUrl: 'http://localhost:4747',
  token: 'SERVER_TOKEN',
  model: 'ollama/kimi-k2.5:cloud',   // "provider/model" as exposed by the gateway
  cwd: process.cwd(),
  permissionMode: 'bypassPermissions',
  contextWindow: 200_000,
};

for await (const ev of runTurn('hello', cfg)) {
  // ev: { type: 'text' | 'thinking' | 'tool' | 'result' | 'error', ... }
  // the final 'result' carries context usage: { tokens, window, percent }
}
```

- `runTurn(prompt, cfg, opts?)` — async generator of agent events (text/thinking/tool deltas + a final result with context usage). Runs the SDK in-process, so it needs full Node/filesystem/shell access (a CLI process or an Electron **main** process — never a sandboxed renderer).
- `fetchModels(serverUrl, token)` — `GET /v1/models` → list of `provider/model` ids.
- `checkServer(serverUrl)` — `GET /health`.

## Build

```bash
npm install
npm run build        # tsc → dist/ (CJS + .d.ts)
```

Consumed locally via a `file:../kalit-code-core` dependency, so clone the
kalit-code repos as siblings.
