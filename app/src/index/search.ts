// Search service wrapper: the contract exposes an async `search`, the panel
// also needs to know whether some resources are still pending or failed.

import type { SearchQuery, SearchResult, SearchService } from '../shared/contracts/content'
import type { ContentIndex, SearchDetail } from './contentIndex.ts'

export interface IndexSearchService extends SearchService {
  readonly index: ContentIndex
  searchDetailed(query: SearchQuery): Promise<SearchDetail>
}

export function createSearchService(index: ContentIndex): IndexSearchService {
  return {
    index,
    async search(query: SearchQuery): Promise<SearchResult[]> {
      return index.search(query)
    },
    async searchDetailed(query: SearchQuery): Promise<SearchDetail> {
      return index.searchDetailed(query)
    }
  }
}
