// Navigation: resolve an Anchor/Link/search locator, then open the owning resource.
// Modules render links; only this service decides how to reach the target.

import type {
  ContentSelector,
  NavigationService,
  SearchResult
} from '../contracts/content'
import type { SharedDataPort } from './port'

/** Host actions supplied by the data layer (store). */
export interface NavigationHost {
  openDocument(
    sourceId: string,
    location?: { page?: number; quote?: string }
  ): Promise<void>
  openNote(sourceId: string): void
  openConversation(sourceId: string, messageId?: string): void
}

interface Located {
  page?: number
  quote?: string
  blockId?: string
  messageId?: string
}

function locate(selector: ContentSelector): Located {
  switch (selector.type) {
    case 'document-text':
      return { page: selector.page, quote: selector.quote.exact }
    case 'document-region':
      return { page: selector.page }
    case 'document-flow':
      return { blockId: selector.blockId }
    case 'note-block':
      return { blockId: selector.blockId }
    case 'message':
      return { messageId: selector.messageId }
    default:
      return {}
  }
}

export function createNavigationService(
  port: SharedDataPort,
  host: NavigationHost
): NavigationService {
  const resolve = (anchorId: string) => {
    const anchor = port.read().anchors[anchorId]
    if (!anchor) throw new Error(`来源不存在或已失效：${anchorId}`)
    const resource = port.read().resources[anchor.resourceId]
    if (!resource) throw new Error('来源资源不存在')
    return { anchor, resource }
  }

  const navigateToAnchor = async (anchorId: string): Promise<void> => {
    const { anchor, resource } = resolve(anchorId)
    if (resource.availability === 'missing') throw new Error('来源文件已缺失')
    const located = locate(anchor.accepted.selector)
    if (resource.kind === 'document') {
      await host.openDocument(resource.sourceId, { page: located.page, quote: located.quote })
    } else if (resource.kind === 'note') {
      host.openNote(resource.sourceId)
    } else {
      host.openConversation(resource.sourceId, located.messageId)
    }
  }

  return {
    navigateToAnchor,
    async navigateToLink(linkId) {
      const link = port.read().links[linkId]
      if (!link) throw new Error('来源关系已失效')
      await navigateToAnchor(link.toAnchorId)
    },
    async navigateToSearchResult(result: SearchResult) {
      const resource = port.read().resources[result.resourceId]
      if (!resource || resource.kind !== 'document') throw new Error('无法打开检索结果')
      const located = locate(result.locator)
      await host.openDocument(resource.sourceId, { page: located.page, quote: located.quote })
    }
  }
}
