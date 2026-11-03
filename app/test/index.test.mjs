import { test } from 'node:test'
import assert from 'node:assert/strict'

import { createContentIndex } from '../src/index/contentIndex.ts'
import { planLegacyRefMigration } from '../src/index/migrate.ts'
import { createRelationIndex } from '../src/index/relations.ts'
import { createAnchorResolver } from '../src/index/resolver.ts'
import { planResourceSync, resourceIdFor } from '../src/index/resources.ts'
import {
  isReusable,
  isSelectorAllowed,
  matchQuote,
  selectorKey,
  validateSelector
} from '../src/index/selectors.ts'
import { markdownBlocks, messageUnits, noteBlockUnits, pageUnits } from '../src/index/units.ts'

// ─── fixtures ──────────────────────────────────────────────────────────────

const QUOTE = '分组密码将明文划分为固定长度的数据块'
const docSelector = { type: 'document-text', page: 2, quote: { exact: QUOTE } }
const docAnchor = {
  id: 'a1',
  resourceId: 'res-doc',
  origin: { revision: 'v1', selector: docSelector },
  accepted: { revision: 'v1', selector: docSelector },
  createdAt: 1,
  updatedAt: 1
}
const docResource = (revision = 'v1', availability = 'available') => ({
  id: 'res-doc',
  kind: 'document',
  sourceId: 'doc',
  title: '第五讲.pdf',
  revision,
  createdAt: 1,
  updatedAt: 1,
  availability
})

const PAGE_TEXT = [
  '第一章 引言。',
  '分组密码将明文划分为固定长度的数据块，在密钥控制下执行可逆变换。',
  '第三章 对称密码与公钥密码的对比。'
]

const fileRecord = {
  id: 'f1',
  name: '第五讲.pdf',
  path: '/tmp/第五讲.pdf',
  kind: 'pdf',
  ext: 'pdf',
  size: 1024,
  mtime: 100,
  hash: 'h1',
  addedAt: 1,
  lastOpenedAt: 1,
  pageCount: 3,
  favorite: false
}

const legacyNote = {
  id: 'n1',
  title: '密码学笔记',
  body: '## 摘录\n\n> 分组密码将明文划分为固定长度的数据块\n\n[来源：第五讲.pdf · 第 2 页](csref:r1)',
  refs: [
    {
      id: 'r1',
      fileId: 'f1',
      page: 2,
      quote: QUOTE,
      label: '第五讲.pdf · 第 2 页',
      createdAt: 5
    }
  ],
  createdAt: 1,
  updatedAt: 2
}

// ─── selector matching and reuse ───────────────────────────────────────────

test('matchQuote finds a verbatim quote and scores it high enough to relocate', () => {
  const matches = matchQuote(PAGE_TEXT[1], docSelector.quote, { page: 2, preferredPage: 2 })
  assert.equal(matches.length, 1)
  assert.ok(matches[0].score >= 0.72)
  assert.equal(matches[0].exact, QUOTE)
})

test('matchQuote ignores whitespace and punctuation differences', () => {
  const matches = matchQuote('分组密码，将明文 划分成固定长度的数据块', { exact: '分组密码将明文划分成固定长度的数据块' })
  assert.equal(matches.length, 1)
})

test('matchQuote uses prefix and suffix context to raise the score', () => {
  const plain = matchQuote(PAGE_TEXT[1], { exact: QUOTE })[0]
  const contextual = matchQuote(PAGE_TEXT[1], {
    exact: QUOTE,
    prefix: '第一章 引言。',
    suffix: '在密钥控制下'
  })[0]
  assert.ok(contextual.score > plain.score)
})

test('matchQuote refuses a quote too short to identify a position', () => {
  assert.equal(matchQuote('分组密码', { exact: '分组' }).length, 0)
})

test('anchor reuse requires the same resource, revision and position', () => {
  const input = { id: 'a2', resourceId: 'res-doc', revision: 'v1', selector: docSelector }
  assert.equal(isReusable(docAnchor, input), true)
  assert.equal(isReusable(docAnchor, { ...input, revision: 'v2' }), false)
  assert.equal(isReusable(docAnchor, { ...input, resourceId: 'res-other' }), false)
  assert.equal(
    isReusable(docAnchor, { ...input, selector: { ...docSelector, page: 3 } }),
    false
  )
  // Same text at a different position is a different anchor.
  const otherRect = { ...docSelector, rects: [[0.1, 0.2, 0.3, 0.02]] }
  assert.equal(isReusable(docAnchor, { ...input, selector: otherRect }), false)
})

test('selectorKey ignores sub-pixel noise and keeps real differences', () => {
  const left = { type: 'document-text', page: 1, quote: { exact: 'abc' }, rects: [[0.1, 0.2, 0.3, 0.4]] }
  const right = { type: 'document-text', page: 1, quote: { exact: 'abc' }, rects: [[0.10001, 0.2, 0.3, 0.4]] }
  assert.equal(selectorKey(left), selectorKey(right))
  assert.notEqual(selectorKey(left), selectorKey({ ...left, page: 2 }))
})

test('selector kinds are validated against the resource kind', () => {
  assert.equal(isSelectorAllowed('document', docSelector), true)
  assert.equal(isSelectorAllowed('conversation', docSelector), false)
  assert.equal(isSelectorAllowed('note', { type: 'message', messageId: 'm1' }), false)
  assert.equal(isSelectorAllowed('conversation', { type: 'message', messageId: 'm1' }), true)
  assert.equal(isSelectorAllowed('note', { type: 'note-block', blockId: 'b1' }), true)
  assert.equal(isSelectorAllowed('document', { type: 'resource' }), true)
  assert.equal(validateSelector('note', docSelector).ok, false)
})

// ─── content index and search ──────────────────────────────────────────────

function buildIndex() {
  const index = createContentIndex({ now: () => 1000 })
  index.replaceUnits(
    'res-doc',
    'v1',
    { kind: 'document', title: '第五讲.pdf' },
    pageUnits('res-doc', 'v1', PAGE_TEXT)
  )
  index.replaceUnits(
    'res-note',
    'n1',
    { kind: 'note', title: '密码学笔记' },
    noteBlockUnits('res-note', 'n1', markdownBlocks('## 分组密码\n\n分组密码把明文分成块。\n\n- 对称密钥'))
  )
  index.replaceUnits(
    'res-conv',
    'c1',
    { kind: 'conversation', title: 'AI 学习会话' },
    messageUnits('res-conv', 'c1', [
      { id: 'm1', role: 'user', content: '分组密码和对称密钥有什么区别？', status: 'done' },
      { id: 'm2', role: 'assistant', content: '分组密码把明文分成固定长度的块。', status: 'done' },
      { id: 'm3', role: 'assistant', content: '正在生成…', status: 'streaming' }
    ])
  )
  return index
}

test('search returns hits from all three resource kinds with snippets', () => {
  const index = buildIndex()
  const hits = index.search({ text: '分组密码' })
  assert.ok(hits.length >= 4)
  assert.ok(hits.every((hit) => hit.snippet.includes('分组密码')))
  assert.ok(hits.every((hit) => hit.score > 0))
  // Streaming messages are not indexed.
  assert.equal(index.search({ text: '正在生成' }).length, 0)
})

test('search filters by resource kind and resource id', () => {
  const index = buildIndex()
  const docs = index.search({ text: '分组密码', resourceKinds: ['document'] })
  assert.ok(docs.length > 0)
  assert.ok(docs.every((hit) => hit.resourceId === 'res-doc'))
  assert.equal(docs[0].locator.type, 'document-text')
  assert.equal(docs[0].locator.page, 2)

  const notes = index.search({ text: '分组密码', resourceKinds: ['note'] })
  assert.ok(notes.length > 0)
  assert.equal(notes[0].locator.type, 'note-block')

  const one = index.search({ text: '分组密码', resourceIds: ['res-conv'] })
  assert.ok(one.length > 0)
  assert.ok(one.every((hit) => hit.resourceId === 'res-conv'))

  const missing = index.search({ text: '分组密码', resourceIds: ['res-none'] })
  assert.equal(missing.length, 0)
})

test('search locator carries the message id and honours the limit', () => {
  const index = buildIndex()
  const hits = index.search({ text: '区别', resourceKinds: ['conversation'] })
  assert.equal(hits.length, 1)
  assert.equal(hits[0].locator.type, 'message')
  assert.equal(hits[0].locator.messageId, 'm1')

  const limited = index.search({ text: '分组密码', limit: 1 })
  assert.equal(limited.length, 1)
})

test('an unfinished index is reported instead of pretending there are no hits', () => {
  const index = buildIndex()
  index.begin('res-pending', 'p1', 'document', '待索引.pdf')
  const detail = index.searchDetailed({ text: '分组密码' })
  assert.ok(detail.incompleteResourceIds.includes('res-pending'))
  assert.equal(detail.failedResourceIds.length, 0)

  index.fail('res-broken', 'b1', '无法读取页面文本')
  const failed = index.searchDetailed({ text: '分组密码' })
  assert.ok(failed.failedResourceIds.includes('res-broken'))

  assert.equal(index.search({ text: '完全不存在的内容' }).length, 0)
  assert.equal(index.status('res-doc').status, 'ready')
})

// ─── resolve statuses ──────────────────────────────────────────────────────

function resolverFixture(overrides = {}) {
  const resources = {
    'res-doc': docResource('v1'),
    'res-moved': { ...docResource('v2'), id: 'res-moved', sourceId: 'moved' },
    'res-gone': docResource('v2', 'missing'),
    ...overrides.resources
  }
  const pageTexts = {
    doc: PAGE_TEXT,
    moved: [PAGE_TEXT[0], PAGE_TEXT[2], PAGE_TEXT[1]],
    ...overrides.pageTexts
  }
  const units = overrides.units ?? {}
  const resolver = createAnchorResolver({
    getResource: (resourceId) => resources[resourceId],
    getPages: (sourceId) => pageTexts[sourceId] ?? null,
    getUnits: (resourceId) => units[resourceId] ?? []
  })
  return resolver
}

test('resolve reports ok when the revision and position still match, without writing', async () => {
  const resolver = resolverFixture()
  const before = JSON.stringify(docAnchor)
  const result = await resolver.resolve(docAnchor)
  assert.equal(result.status, 'ok')
  assert.equal(JSON.stringify(docAnchor), before)
})

test('resolve reports relocated when the quote moved to another page', async () => {
  const resolver = resolverFixture()
  const anchor = {
    ...docAnchor,
    resourceId: 'res-moved',
    accepted: { revision: 'v1', selector: docSelector }
  }
  const result = await resolver.resolve(anchor)
  assert.equal(result.status, 'relocated')
  assert.equal(result.selector.type, 'document-text')
  assert.equal(result.selector.page, 3)
  assert.equal(anchor.accepted.selector.page, 2)
})

test('resolve reports ambiguous when two candidates cannot be told apart', async () => {
  const resolver = resolverFixture({
    resources: { 'res-twin': { ...docResource('v2'), id: 'res-twin', sourceId: 'twin' } },
    pageTexts: { twin: ['同一段文字出现在这里。', '同一段文字出现在这里。'] }
  })
  const anchor = {
    ...docAnchor,
    resourceId: 'res-twin',
    accepted: {
      revision: 'v1',
      selector: { type: 'document-text', page: 1, quote: { exact: '同一段文字出现在这里' } }
    }
  }
  const result = await resolver.resolve(anchor)
  assert.equal(result.status, 'ambiguous')
  assert.ok(result.candidates.length >= 2)
})

test('resolve reports orphaned when the text is gone and missing when the source is unavailable', async () => {
  const orphaned = resolverFixture({
    resources: { 'res-other': { ...docResource('v2'), id: 'res-other', sourceId: 'other' } },
    pageTexts: { other: ['完全不同的内容。', '没有那段话了。', '结尾。'] }
  })
  const gone = await orphaned.resolve({ ...docAnchor, resourceId: 'res-other' })
  assert.equal(gone.status, 'orphaned')

  const missing = await resolverFixture().resolve({ ...docAnchor, resourceId: 'res-gone' })
  assert.equal(missing.status, 'missing')

  const absent = await resolverFixture().resolve({ ...docAnchor, resourceId: 'res-unknown' })
  assert.equal(absent.status, 'missing')
})

test('resolve reports unlocatable for a scanned page and for geometry after a version change', async () => {
  const resolver = resolverFixture({
    resources: { 'res-scan': { ...docResource('v1'), id: 'res-scan', sourceId: 'scan' } },
    pageTexts: { scan: ['', '', ''] }
  })
  const scanned = await resolver.resolve({
    ...docAnchor,
    resourceId: 'res-scan',
    accepted: { revision: 'v1', selector: docSelector }
  })
  assert.equal(scanned.status, 'unlocatable')

  const regionAnchor = {
    ...docAnchor,
    resourceId: 'res-moved',
    accepted: {
      revision: 'v1',
      selector: { type: 'document-region', page: 2, geometry: { type: 'rect', rect: [0.1, 0.1, 0.2, 0.2] } }
    }
  }
  const region = await resolver.resolve(regionAnchor)
  assert.equal(region.status, 'unlocatable')
})

test('message anchors never re-point to another message', async () => {
  const index = buildIndex()
  const units = { 'res-conv': index.units('res-conv') }
  const resolver = resolverFixture({
    resources: {
      'res-conv': {
        id: 'res-conv',
        kind: 'conversation',
        sourceId: 'main',
        title: 'AI 学习会话',
        revision: 'c1',
        createdAt: 1,
        updatedAt: 1,
        availability: 'available'
      }
    },
    units
  })
  const base = {
    id: 'am',
    resourceId: 'res-conv',
    origin: { revision: 'c1', selector: { type: 'message', messageId: 'm1' } },
    accepted: { revision: 'c1', selector: { type: 'message', messageId: 'm1' } },
    createdAt: 1,
    updatedAt: 1
  }
  assert.equal((await resolver.resolve(base)).status, 'ok')

  const edited = await resolver.resolve({
    ...base,
    accepted: {
      revision: 'c1',
      selector: { type: 'message', messageId: 'm1', quote: { exact: '不存在的摘录' } }
    }
  })
  assert.equal(edited.status, 'orphaned')

  const deleted = await resolver.resolve({
    ...base,
    accepted: { revision: 'c1', selector: { type: 'message', messageId: 'm9' } }
  })
  assert.equal(deleted.status, 'orphaned')
})

test('note-block anchors recover by quote and stop at ambiguous matches', async () => {
  const index = createContentIndex({ now: () => 1 })
  index.replaceUnits(
    'res-note',
    'n1',
    { kind: 'note', title: '密码学笔记' },
    noteBlockUnits('res-note', 'n1', [
      { blockId: 'blk-a', text: '分组密码把明文分成块。' },
      { blockId: 'blk-b', text: '对称密钥用于加密和解密。' },
      { blockId: 'blk-c', text: '重复的原文段落。' },
      { blockId: 'blk-d', text: '重复的原文段落。' }
    ])
  )
  const resolver = resolverFixture({
    resources: {
      'res-note': {
        id: 'res-note',
        kind: 'note',
        sourceId: 'n1',
        title: '密码学笔记',
        revision: 'n1',
        createdAt: 1,
        updatedAt: 1,
        availability: 'available'
      }
    },
    units: { 'res-note': index.units('res-note') }
  })
  const base = {
    id: 'an',
    resourceId: 'res-note',
    origin: { revision: 'n1', selector: { type: 'note-block', blockId: 'blk-a' } },
    accepted: { revision: 'n1', selector: { type: 'note-block', blockId: 'blk-a' } },
    createdAt: 1,
    updatedAt: 1
  }
  assert.equal((await resolver.resolve(base)).status, 'ok')

  const relocated = await resolver.resolve({
    ...base,
    accepted: {
      revision: 'n1',
      selector: { type: 'note-block', blockId: 'blk-gone', quote: { exact: '对称密钥用于加密和解密' } }
    }
  })
  assert.equal(relocated.status, 'relocated')
  assert.equal(relocated.selector.blockId, 'blk-b')

  const ambiguous = await resolver.resolve({
    ...base,
    accepted: {
      revision: 'n1',
      selector: { type: 'note-block', blockId: 'blk-gone', quote: { exact: '重复的原文段落' } }
    }
  })
  assert.equal(ambiguous.status, 'ambiguous')
  assert.equal(ambiguous.candidates.length, 2)
})

// ─── relation index ────────────────────────────────────────────────────────

function relationFixture() {
  let slices = {
    resources: {
      'res-doc': { ...docResource('v1') },
      'res-note': {
        id: 'res-note',
        kind: 'note',
        sourceId: 'n1',
        title: '密码学笔记',
        revision: 'n1',
        createdAt: 1,
        updatedAt: 1,
        availability: 'available'
      }
    },
    anchors: {
      a1: { ...docAnchor, id: 'a1', resourceId: 'res-note', accepted: { revision: 'n1', selector: { type: 'resource' } } },
      a2: { ...docAnchor, id: 'a2', resourceId: 'res-doc' },
      a3: { ...docAnchor, id: 'a3', resourceId: 'res-doc', accepted: { revision: 'v1', selector: { ...docSelector, page: 3 } } }
    },
    links: {
      l1: {
        id: 'l1',
        fromAnchorId: 'a1',
        toAnchorId: 'a2',
        relation: 'quotes',
        createdBy: 'user',
        verification: 'unverified',
        createdAt: 1
      },
      l2: {
        id: 'l2',
        fromAnchorId: 'a2',
        toAnchorId: 'a3',
        relation: 'references',
        createdBy: 'user',
        verification: 'unverified',
        createdAt: 2
      }
    }
  }
  return {
    relations: createRelationIndex(() => slices),
    replaceLinks(links) {
      slices = { ...slices, links }
    },
    slices: () => slices
  }
}

test('relation index answers from/to/resource lookups and directions', () => {
  const { relations } = relationFixture()
  assert.deepEqual(relations.linksFrom('a1').map((link) => link.id), ['l1'])
  assert.deepEqual(relations.linksTo('a2').map((link) => link.id), ['l1'])
  assert.deepEqual(relations.linksForAnchor('a2').map((link) => link.id).sort(), ['l1', 'l2'])
  assert.deepEqual(relations.linksForAnchor('a2', 'outgoing').map((link) => link.id), ['l2'])
  assert.deepEqual(relations.linksForAnchor('a2', 'incoming').map((link) => link.id), ['l1'])
  assert.deepEqual(relations.anchorIdsForResource('res-doc').sort(), ['a2', 'a3'])
  assert.deepEqual(relations.linksForResource('res-doc').map((link) => link.id).sort(), ['l1', 'l2'])
})

test('related content is one hop only and never inferred from similarity', () => {
  const { relations } = relationFixture()
  const related = relations.relatedContent('res-doc')
  assert.equal(related.length, 2)
  const toNote = related.find((item) => item.otherResourceId === 'res-note')
  assert.equal(toNote.direction, 'incoming')
  assert.equal(toNote.relation, 'quotes')
  assert.equal(toNote.otherKind, 'note')
  // a1 -> a2 -> a3 does not create a1 -> a3.
  assert.equal(relations.linksFrom('a1').length, 1)
  assert.equal(relations.relatedContent('res-note').length, 1)
})

test('relation index follows immutable slice replacement', () => {
  const { relations, replaceLinks, slices } = relationFixture()
  assert.equal(relations.linksForResource('res-doc').length, 2)
  replaceLinks({
    ...slices().links,
    l3: {
      id: 'l3',
      fromAnchorId: 'a1',
      toAnchorId: 'a3',
      relation: 'references',
      createdBy: 'user',
      verification: 'unverified',
      createdAt: 3
    }
  })
  assert.equal(relations.linksForResource('res-doc').length, 3)
  assert.equal(relations.entriesForAnchor('a1').length, 2)
})

// ─── resource sync and NoteRef migration ───────────────────────────────────

test('resource sync is idempotent and tracks availability', () => {
  const first = planResourceSync({ resources: {}, files: [fileRecord], notes: [legacyNote], messages: [], now: 1 })
  assert.equal(first.upserts.length, 2)
  assert.equal(first.bySource.document.get('f1'), resourceIdFor('document', 'f1'))
  assert.equal(first.bySource.note.get('n1'), resourceIdFor('note', 'n1'))

  const second = planResourceSync({ resources: first.resources, files: [fileRecord], notes: [legacyNote], messages: [], now: 2 })
  assert.equal(second.upserts.length, 0)

  const missing = planResourceSync({
    resources: first.resources,
    files: [{ ...fileRecord, missing: true }],
    notes: [legacyNote],
    messages: [],
    now: 3
  })
  assert.equal(missing.resources[first.bySource.document.get('f1')].availability, 'missing')

  const deleted = planResourceSync({ resources: first.resources, files: [], notes: [], messages: [], now: 4 })
  assert.equal(deleted.resources[first.bySource.document.get('f1')].availability, 'deleted')
  assert.equal(deleted.resources[first.bySource.note.get('n1')].availability, 'deleted')
})

test('conversation revision changes when messages change', () => {
  const empty = planResourceSync({ resources: {}, files: [], notes: [], messages: [], now: 1 })
  assert.equal(empty.bySource.conversation.size, 0)

  const one = planResourceSync({
    resources: {},
    files: [],
    notes: [],
    messages: [{ id: 'm1', role: 'user', content: '你好', createdAt: 1 }],
    now: 2
  })
  const conversationId = one.bySource.conversation.get('main')
  assert.ok(conversationId)

  const two = planResourceSync({
    resources: one.resources,
    files: [],
    notes: [],
    messages: [
      { id: 'm1', role: 'user', content: '你好', createdAt: 1 },
      { id: 'm2', role: 'assistant', content: '你好，有什么可以帮你？', createdAt: 2 }
    ],
    now: 3
  })
  assert.notEqual(two.resources[conversationId].revision, one.resources[conversationId].revision)
})

test('NoteRef migration creates a quote link with a snapshot and is idempotent', () => {
  const first = planLegacyRefMigration({
    resources: {},
    files: [fileRecord],
    notes: [legacyNote],
    anchors: {},
    links: {},
    now: 10
  })
  assert.equal(first.createdLinkIds.length, 1)
  assert.equal(first.createdAnchorIds.length, 2)
  assert.equal(first.createdResourceIds.length, 2)

  const link = first.links[first.createdLinkIds[0]]
  assert.equal(link.relation, 'quotes')
  assert.equal(link.createdBy, 'user')
  assert.equal(link.verification, 'unverified')
  const target = first.anchors[link.toAnchorId]
  assert.equal(target.accepted.selector.type, 'document-text')
  assert.equal(target.accepted.selector.page, 2)
  assert.equal(target.accepted.selector.quote.exact, QUOTE)
  assert.equal(target.snapshot.text, QUOTE)
  assert.equal(target.resourceId, resourceIdFor('document', 'f1'))

  const second = planLegacyRefMigration({
    resources: first.resources,
    files: [fileRecord],
    notes: [legacyNote],
    anchors: first.anchors,
    links: first.links,
    now: 11
  })
  assert.equal(second.createdLinkIds.length, 0)
  assert.equal(second.createdAnchorIds.length, 0)
  assert.equal(second.createdResourceIds.length, 0)
  assert.deepEqual(second.links, first.links)
  assert.deepEqual(second.anchors, first.anchors)
  // Original data is preserved.
  assert.equal(legacyNote.refs.length, 1)
  assert.equal(legacyNote.refs[0].quote, QUOTE)
})

test('NoteRef migration keeps snapshots when the file is gone and skips empty quotes', () => {
  const orphan = planLegacyRefMigration({
    resources: {},
    files: [],
    notes: [legacyNote],
    anchors: {},
    links: {},
    now: 10
  })
  const link = orphan.links[orphan.createdLinkIds[0]]
  const target = orphan.anchors[link.toAnchorId]
  assert.equal(orphan.resources[target.resourceId].availability, 'deleted')
  assert.equal(target.snapshot.text, QUOTE)
  assert.equal(target.accepted.selector.quote.exact, QUOTE)

  const emptyQuoteNote = {
    ...legacyNote,
    refs: [{ ...legacyNote.refs[0], id: 'r2', quote: '   ' }]
  }
  const skipped = planLegacyRefMigration({
    resources: {},
    files: [fileRecord],
    notes: [emptyQuoteNote],
    anchors: {},
    links: {},
    now: 10
  })
  assert.equal(skipped.createdLinkIds.length, 0)
  assert.deepEqual(skipped.skippedRefIds, ['r2'])
})
