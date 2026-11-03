import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildPageTextIndex,
  extractQuote,
  findQuoteCandidates,
  findQuoteOnPage,
  normalizeForMatch,
  normalizeWithMap,
  pickQuoteMatch
} from '../src/reader/textMapping.ts'
import {
  convertGeometryRotation,
  convertRectRotation,
  geometryBounds,
  normalizeRect,
  rectFromClient,
  rectsFromClient
} from '../src/reader/geometry.ts'
import { resolveAnnotation } from '../src/reader/annotationResolve.ts'
import { hitTestAnnotations } from '../src/reader/hitTest.ts'
import {
  isLegacyAnnotation,
  isMigratedAnnotation,
  LEGACY_UNKNOWN_REVISION,
  migrateStoredAnnotations,
  planAnnotationMigration
} from '../src/reader/migrate.ts'
import {
  clampReadingState,
  clampZoom,
  createReadingState,
  legacyReadingState,
  patchReadingState
} from '../src/reader/readingState.ts'
import { createAsksAboutLink } from '../src/reader/links.ts'
import {
  validateAnnotation,
  validateAnnotationDraft,
  validateBody,
  validateSelection,
  validateStyle
} from '../src/reader/validate.ts'

// ─── text mapping ──────────────────────────────────────────────────────────

test('normalization keeps a raw-offset map for every normalised character', () => {
  const raw = 'ＡＢ，Ｃ d'
  const { normalized, map } = normalizeWithMap(raw)
  assert.equal(normalized, 'abcd')
  assert.deepEqual(map, [0, 1, 3, 5])
  assert.equal(raw[map[2]], 'Ｃ')
})

test('a repeated quote yields two candidates and is reported as ambiguous', () => {
  const raw = '固定块很重要。固定块很重要。'
  const index = buildPageTextIndex(raw)
  const candidates = findQuoteCandidates(index, '固定块很重要')
  assert.equal(candidates.length, 2)
  assert.equal(index.normalized.slice(candidates[0].normalizedStart, candidates[0].normalizedStart + 6), '固定块很重要')
  const picked = pickQuoteMatch(findQuoteOnPage(1, index, { exact: '固定块很重要' }))
  assert.equal(picked.ambiguous, true)
})

test('prefix and suffix disambiguate a repeated quote', () => {
  const raw = '开头。固定块很重要。中间。固定块很重要。结尾。'
  const start = raw.lastIndexOf('固定块很重要')
  const quote = extractQuote(raw, start, start + '固定块很重要'.length, 4)
  assert.equal(quote.exact, '固定块很重要')
  assert.ok(quote.prefix.includes('中间'))
  const matches = findQuoteOnPage(1, buildPageTextIndex(raw), quote)
  const picked = pickQuoteMatch(matches)
  assert.equal(picked.ambiguous, false)
  assert.equal(picked.match.rawStart, start)
  assert.ok(picked.confidence > 0.5)
})

test('normalisation ignores width, case and punctuation', () => {
  assert.equal(normalizeForMatch('ＡＢＣ．'), normalizeForMatch('abc'))
  assert.equal(normalizeForMatch('分组密码，将明文 划分'), normalizeForMatch('分组密码将明文划分'))
})

// ─── geometry ──────────────────────────────────────────────────────────────

const closeTo = (actual, expected, epsilon = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= epsilon, `${actual} != ${expected}`)
}

const assertRect = (actual, expected) => {
  assert.equal(actual.length, 4)
  for (let index = 0; index < 4; index++) closeTo(actual[index], expected[index])
}

test('rectangles are clamped to the page and zero-area rects are dropped', () => {
  assertRect(normalizeRect([0.8, 0.9, 0.5, 0.5]), [0.8, 0.9, 0.2, 0.1])
  assert.equal(normalizeRect([0.2, 0.2, 0, 0.5]), null)
  assert.equal(normalizeRect([0.2, 0.2, Number.NaN, 0.5]), null)
})

test('client rectangles become page-normalised multi-line rects', () => {
  const page = { left: 100, top: 50, width: 200, height: 400 }
  assertRect(rectFromClient(page, { left: 150, top: 150, width: 100, height: 40 }), [0.25, 0.25, 0.5, 0.1])
  const rects = rectsFromClient(page, [
    { left: 150, top: 150, width: 100, height: 40 },
    { left: 150, top: 200, width: 50, height: 20 },
    { left: 150, top: 200, width: 0, height: 20 }
  ])
  assert.equal(rects.length, 2)
  assertRect(rects[1], [0.25, 0.375, 0.25, 0.05])
})

test('rotation conversion round-trips and swaps dimensions', () => {
  const rect = [0.1, 0.2, 0.3, 0.4]
  const rotated = convertRectRotation(rect, 0, 90)
  assertRect(rotated, [0.4, 0.1, 0.4, 0.3])
  const back = convertRectRotation(rotated, 90, 0)
  assertRect(back, rect)
  const arrow = convertGeometryRotation({ type: 'arrow', from: [0.2, 0.3], to: [0.6, 0.8] }, 0, 180)
  closeTo(arrow.from[0], 0.8)
  assertRect(geometryBounds({ type: 'rect', rect: [0.1, 0.1, 0.2, 0.2] }), [0.1, 0.1, 0.2, 0.2])
})

// ─── resolution ────────────────────────────────────────────────────────────

const pageOne = '分组密码将明文划分为固定长度的数据块，在密钥控制下执行可逆变换。'
const pageTwo = '分组密码是一种对称密码体制，加密与解密使用相同密钥。'

function makeAnchor (selector, revision = 'rev1') {
  return {
    id: 'a1',
    resourceId: 'r1',
    origin: { revision, selector },
    accepted: { revision, selector },
    createdAt: 1,
    updatedAt: 1
  }
}

function makeAnnotation (anchorId = 'a1', kind = 'highlight') {
  return {
    id: 'n1',
    resourceId: 'r1',
    anchorId,
    kind,
    style: { color: '#d9c48f', opacity: 0.45 },
    createdAt: 1,
    updatedAt: 1
  }
}

function textSelector (overrides = {}) {
  return {
    type: 'document-text',
    page: 1,
    quote: { exact: pageOne.slice(0, 10) },
    rects: [[0.1, 0.1, 0.3, 0.04]],
    rotation: 0,
    ...overrides
  }
}

function context (anchor, overrides = {}) {
  return {
    revision: 'rev1',
    pageCount: 2,
    pageText: (page) => (page === 1 ? pageOne : page === 2 ? pageTwo : undefined),
    rotationFor: () => 0,
    anchorFor: (id) => (id === anchor?.id ? anchor : undefined),
    resourceAvailable: true,
    ...overrides
  }
}

test('a matching revision and rotation resolves to ok with its rects', () => {
  const anchor = makeAnchor(textSelector())
  const resolved = resolveAnnotation(makeAnnotation(), context(anchor))
  assert.equal(resolved.status, 'ok')
  assert.equal(resolved.page, 1)
  assert.equal(resolved.rects.length, 1)
  assert.equal(resolved.confidence, 1)
})

test('a changed revision relocates by quote instead of trusting old coordinates', () => {
  const anchor = makeAnchor(textSelector(), 'rev-old')
  const resolved = resolveAnnotation(makeAnnotation(), context(anchor, { revision: 'rev-new' }))
  assert.equal(resolved.status, 'relocated')
  assert.equal(resolved.page, 1)
  assert.ok(resolved.confidence > 0)
})

test('a quote found twice on the page is ambiguous and not drawn', () => {
  const repeated = '重复的句子。重复的句子。'
  const anchor = makeAnchor(textSelector({ quote: { exact: '重复的句子' }, rects: undefined }), 'rev-old')
  const resolved = resolveAnnotation(
    makeAnnotation(),
    context(anchor, { revision: 'rev-new', pageText: () => repeated })
  )
  assert.equal(resolved.status, 'ambiguous')
  assert.equal(resolved.rects, undefined)
})

test('a missing quote becomes orphaned; a changed region becomes unlocatable', () => {
  const orphan = makeAnchor(textSelector({ quote: { exact: '这段原文不存在' } }), 'rev-old')
  assert.equal(resolveAnnotation(makeAnnotation(), context(orphan, { revision: 'rev-new' })).status, 'orphaned')

  const region = makeAnchor(
    { type: 'document-region', page: 1, geometry: { type: 'rect', rect: [0.1, 0.1, 0.2, 0.2] }, rotation: 0 },
    'rev-old'
  )
  assert.equal(resolveAnnotation(makeAnnotation('a1', 'rect'), context(region, { revision: 'rev-new' })).status, 'unlocatable')
})

test('a rotation change relocates text rects into the current page box', () => {
  const anchor = makeAnchor(textSelector())
  const resolved = resolveAnnotation(makeAnnotation(), context(anchor, { rotationFor: () => 90 }))
  assert.equal(resolved.status, 'relocated')
  assert.ok(Math.abs(resolved.rects[0][0] - 0.86) < 1e-9)
})

test('a missing anchor or unavailable resource reports missing', () => {
  assert.equal(resolveAnnotation(makeAnnotation('missing'), context(null)).status, 'missing')
  const anchor = makeAnchor(textSelector())
  assert.equal(
    resolveAnnotation(makeAnnotation(), context(anchor, { resourceAvailable: false })).status,
    'missing'
  )
})

test('a shrunken document relocates the quote to a remaining page', () => {
  const anchor = makeAnchor(textSelector({ page: 9 }), 'rev1')
  const resolved = resolveAnnotation(makeAnnotation(), context(anchor, { pageCount: 2 }))
  assert.equal(resolved.status, 'relocated')
  assert.equal(resolved.page, 1)
})

// ─── hit testing ───────────────────────────────────────────────────────────

test('hit testing prefers the smallest annotation under the point', () => {
  const big = { annotation: { ...makeAnnotation('a1'), id: 'big' }, status: 'ok', page: 1, rects: [[0.1, 0.1, 0.6, 0.6]] }
  const small = { annotation: { ...makeAnnotation('a2'), id: 'small' }, status: 'ok', page: 1, rects: [[0.2, 0.2, 0.05, 0.05]] }
  const hits = hitTestAnnotations([0.22, 0.22], [big, small])
  assert.equal(hits.length, 2)
  assert.equal(hits[0].annotation.id, 'small')
  assert.equal(hitTestAnnotations([0.9, 0.9], [big, small]).length, 0)
})

// ─── validation ────────────────────────────────────────────────────────────

test('a note annotation requires a non-empty plain-text body', () => {
  assert.equal(validateBody('note', undefined).ok, false)
  assert.equal(validateBody('note', '   ').ok, false)
  assert.equal(validateBody('note', '值得记住').ok, true)
  assert.equal(validateBody('highlight', '').ok, true)
  const note = { ...makeAnnotation('a1', 'note'), body: '' }
  assert.equal(validateAnnotation(note).ok, false)
  assert.equal(validateAnnotation({ ...note, body: '有内容' }).ok, true)
})

test('invalid colour, opacity and empty selections are rejected before writing', () => {
  assert.equal(validateStyle({ color: '' }).ok, false)
  assert.equal(validateStyle({ color: '#d9c48f', opacity: 1.4 }).ok, false)
  assert.equal(validateStyle({ color: '#d9c48f', opacity: 0.4, strokeWidth: 2 }).ok, true)
  assert.equal(
    validateSelection({
      kind: 'text',
      resourceId: 'r1',
      revision: 'rev1',
      selector: { type: 'document-text', page: 1, quote: { exact: '' }, rects: [] },
      text: ''
    }).ok,
    false
  )
  const draft = validateAnnotationDraft({
    selection: {
      kind: 'text',
      resourceId: 'r1',
      revision: 'rev1',
      selector: { type: 'document-text', page: 1, quote: { exact: '原文' }, rects: [[0.1, 0.1, 0.2, 0.1]], rotation: 0 },
      text: '原文'
    },
    kind: 'note',
    style: { color: '#d9c48f' },
    body: ''
  })
  assert.equal(draft.ok, false)
})

// ─── migration ─────────────────────────────────────────────────────────────

const legacyRecord = {
  id: 'legacy-1',
  fileId: 'file-1',
  page: 2,
  rects: [[0.1, 0.2, 0.3, 0.04]],
  text: '旧版标注的原文',
  comment: '当时的想法',
  createdAt: 1000
}

test('legacy annotations become anchor-backed annotations and keep the raw record', () => {
  const plan = planAnnotationMigration({
    annotations: [legacyRecord],
    files: [{ id: 'file-1', name: 'a.pdf', hash: 'hash-new', mtime: 2000 }]
  })
  assert.equal(plan.pending.length, 1)
  assert.equal(plan.legacy.length, 1)
  const item = plan.pending[0]
  assert.equal(item.revision, LEGACY_UNKNOWN_REVISION)
  assert.equal(item.annotation.anchorId, 'anchor-legacy-1')
  assert.equal(item.annotation.body, '当时的想法')
  assert.equal(item.annotation.kind, 'highlight')
  assert.equal(item.selector.type, 'document-text')
  assert.equal(item.selector.page, 2)
  assert.equal(item.selector.quote.exact, '旧版标注的原文')
  assert.equal(item.selector.rects.length, 1)
  assertRect(item.selector.rects[0], legacyRecord.rects[0])
  assert.equal(isLegacyAnnotation(legacyRecord), true)
})

test('an unmodified file lets the current hash stand in for the creation revision', () => {
  const plan = planAnnotationMigration({
    annotations: [legacyRecord],
    files: [{ id: 'file-1', name: 'a.pdf', hash: 'hash-current', mtime: 500 }]
  })
  assert.equal(plan.pending[0].revision, 'hash-current')
})

test('migration is idempotent and never loses the original record', async () => {
  const created = []
  const anchorService = {
    createOrReuse: (input) => {
      created.push(input)
      return { ...input, origin: { revision: input.revision, selector: input.selector }, accepted: { revision: input.revision, selector: input.selector } }
    },
    getAnchor: () => undefined,
    removeIfUnused: () => {}
  }
  const transactions = { run: async (_id, prepare) => prepare({ operationId: _id }) }
  const first = await migrateStoredAnnotations({
    annotations: [legacyRecord],
    files: [{ id: 'file-1', name: 'a.pdf', hash: 'hash', mtime: 2000 }],
    ensureResource: async () => 'r1',
    anchorService,
    transactions
  })
  assert.equal(first.migrated, 1)
  assert.equal(first.failures.length, 0)
  assert.equal(first.annotations.length, 1)
  assert.equal(first.annotations[0].resourceId, 'r1')
  assert.equal(created[0].resourceId, 'r1')
  assert.equal(first.legacyAnnotations.length, 1)
  assert.equal(isMigratedAnnotation(first.annotations[0]), true)

  const second = await migrateStoredAnnotations({
    annotations: first.annotations,
    legacyAnnotations: first.legacyAnnotations,
    files: [{ id: 'file-1', name: 'a.pdf', hash: 'hash', mtime: 2000 }],
    ensureResource: async () => 'r1',
    anchorService,
    transactions
  })
  assert.equal(second.migrated, 0)
  assert.equal(second.annotations.length, 1)
  assert.equal(second.legacyAnnotations.length, 1)
})

test('a failed migration keeps the raw record for the next attempt', async () => {
  const outcome = await migrateStoredAnnotations({
    annotations: [legacyRecord],
    files: [{ id: 'file-1', name: 'a.pdf', hash: 'hash', mtime: 2000 }],
    ensureResource: async () => {
      throw new Error('no resource')
    },
    anchorService: { createOrReuse: () => {}, getAnchor: () => undefined, removeIfUnused: () => {} },
    transactions: { run: async (_id, prepare) => prepare({ operationId: _id }) }
  })
  assert.equal(outcome.migrated, 0)
  assert.equal(outcome.failures.length, 1)
  assert.equal(outcome.annotations.length, 0)
  assert.equal(outcome.legacyAnnotations.length, 1)
})

// ─── reading state ─────────────────────────────────────────────────────────
test('reading state clamps to the last valid page when a document shrinks', () => {
  const state = createReadingState({ resourceId: 'r1', page: 9, zoom: 1.4, now: 1 })
  const clamped = clampReadingState(state, 3)
  assert.equal(clamped.location.page, 3)
  assert.equal(clamped.zoom, 1.4)
  assert.equal(clamped.showAnnotations, true)
  assert.equal(clampZoom(9), 3)
  assert.equal(clampZoom(0.1), 0.6)
})

test('patching the page keeps the saved scroll ratio and legacy state still reads', () => {
  const state = createReadingState({ resourceId: 'r1', page: 2, scrollRatio: 0.42, now: 1 })
  const patched = patchReadingState(state, { location: { page: 4 } }, 2)
  assert.equal(patched.location.page, 4)
  assert.equal(patched.location.scrollRatio, 0.42)
  const legacy = legacyReadingState({ resourceId: 'r1', page: 3, zoom: 1.2, now: 1 })
  assert.equal(legacy.location.page, 3)
  assert.equal(legacy.zoom, 1.2)
  assert.equal(legacyReadingState({ resourceId: 'r1' }), null)
})

// ─── asks_about link ───────────────────────────────────────────────────────

test('sending a question links the message anchor to the document selection', async () => {
  const anchors = new Map()
  const createdLinks = []
  let counter = 0
  const nextId = () => `id-${++counter}`
  const anchorService = {
    createOrReuse: (input) => {
      const anchor = {
        id: input.id,
        resourceId: input.resourceId,
        origin: { revision: input.revision, selector: input.selector },
        accepted: { revision: input.revision, selector: input.selector },
        snapshot: input.snapshot,
        createdAt: 1,
        updatedAt: 1
      }
      anchors.set(anchor.id, anchor)
      return anchor
    },
    getAnchor: (id) => anchors.get(id),
    removeIfUnused: () => {}
  }
  const linkService = {
    createLink: (link) => {
      createdLinks.push(link)
      return link
    },
    removeLink: () => {},
    getLink: () => undefined,
    getLinks: () => []
  }
  const resourceRegistry = {
    ensureResource: async (ref) => ({
      id: 'conv-1',
      kind: ref.kind,
      sourceId: ref.sourceId,
      title: '',
      revision: '0',
      createdAt: 1,
      updatedAt: 1,
      availability: 'available'
    }),
    getResource: () => undefined
  }
  const link = await createAsksAboutLink(
    {
      selection: {
        kind: 'text',
        resourceId: 'r1',
        revision: 'rev1',
        selector: {
          type: 'document-text',
          page: 1,
          quote: { exact: '被提问的原文' },
          rects: [[0.1, 0.1, 0.2, 0.05]],
          rotation: 0
        },
        text: '被提问的原文'
      },
      messageId: 'm1'
    },
    {
      transactions: { run: async (_id, prepare) => prepare({ operationId: _id }) },
      anchorService,
      linkService,
      resourceRegistry,
      now: () => 5,
      nextId
    }
  )
  assert.equal(link.relation, 'asks_about')
  assert.equal(link.createdBy, 'user')
  assert.equal(link.verification, 'user_confirmed')
  assert.equal(anchors.get(link.fromAnchorId).accepted.selector.type, 'message')
  assert.equal(anchors.get(link.fromAnchorId).resourceId, 'conv-1')
  assert.equal(anchors.get(link.toAnchorId).resourceId, 'r1')
  assert.equal(anchors.get(link.toAnchorId).accepted.selector.quote.exact, '被提问的原文')
  assert.equal(createdLinks.length, 1)
})
