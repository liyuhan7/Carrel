/**
 * Web search contract, reserved for the search phase.
 *
 * Nothing calls this yet: the chat pipeline never searches today, and no
 * provider is configured. The types exist so the request layer can adopt
 * them without a second migration. Native provider search (OpenAI / Gemini
 * server tools) would be declared as a model capability instead of a
 * WebSearchProvider.
 */

export interface WebSearchHit {
  id: string
  title: string
  url: string
  snippet: string
  providerId: string
  retrievedAt: string
}

export interface WebSearchResult {
  query: string
  hits: WebSearchHit[]
  status: 'ok' | 'empty' | 'failed'
  errorMessage?: string
}

export interface WebSearchProvider {
  id: string
  name: string
  search(query: string, options?: { signal?: AbortSignal; limit?: number }): Promise<WebSearchResult>
}
