import MarkdownIt from 'markdown-it'
import type { Citation } from '../types'

export const md = new MarkdownIt({ html: false, linkify: true, breaks: true })

const defaultLinkOpen = md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options))

// Note references use `[第五讲.pdf · 第 8 页](csref:<refId>)` so the markdown
// stays plain text and every reference still points at a stored anchor.
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const href = tokens[idx].attrGet('href') || ''
  if (href.startsWith('csref:')) {
    tokens[idx].attrSet('href', '#')
    tokens[idx].attrSet('data-ref', href.slice(6))
    tokens[idx].attrSet('class', 'ref-link')
  }
  return defaultLinkOpen(tokens, idx, options, env, self)
}

export function escapeHtml (value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

function chip (page: number, citation: Citation | undefined): string {
  if (citation?.verified) {
    return `<button class="cite is-verified" data-page="${page}" title="${escapeHtml(citation.quote)}">第 ${page} 页</button>`
  }
  return `<button class="cite is-unverified" data-page="${page}" title="回答提到了第 ${page} 页，但没有可核实的原文摘录">第 ${page} 页</button>`
}

export function renderAnswer (text: string, citations: Citation[] = []): string {
  const html = md.render(text)
  return html.replace(/\[\[\s*p\s*(\d+)\s*\]\]/gi, (_match, raw) => {
    const page = Number(raw)
    return chip(page, citations.find((c) => c.page === page))
  })
}

export function renderNote (body: string): string {
  return md.render(body)
}
