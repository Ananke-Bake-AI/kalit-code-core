// ============================================================
// kalit-code-core — model-server helpers (shared)
// ============================================================

export interface ServerHealth {
  ok: boolean;
  /** First provider's display model (or "(client-chosen)"), if reported. */
  model?: string;
  providers?: Array<{ name?: string; kind?: string; model?: string }>;
}

/** GET /health on the gateway. Tolerates both v2 {providers:[…]} and legacy
 *  {provider:{…}} shapes. */
export async function checkServer(serverUrl: string): Promise<ServerHealth> {
  try {
    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/health`);
    if (!res.ok) return { ok: false };
    const body = await res.json() as {
      provider?: { name?: string; model?: string; kind?: string };
      providers?: Array<{ name?: string; model?: string; kind?: string }>;
    };
    const providers = body.providers ?? (body.provider ? [body.provider] : []);
    return { ok: true, model: providers[0]?.model, providers };
  } catch {
    return { ok: false };
  }
}

/** GET /v1/models → the list of "provider/model" ids the gateway exposes. */
export async function fetchModels(serverUrl: string, token: string): Promise<string[]> {
  try {
    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/v1/models`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const body = await res.json() as { data?: Array<{ id?: string }> };
    return (body.data ?? []).map(m => m.id).filter((x): x is string => !!x);
  } catch {
    return [];
  }
}
