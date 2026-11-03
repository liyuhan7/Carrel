import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseBlocks, reconcileBlocks, revisionOf, blockAtOffset } from '../src/notes/blocks.ts'
import { computeInsertion, placementFromPosition } from '../src/notes/placement.ts'
import { createNoteInsertService } from '../src/notes/insertService.ts'
import { buildCaptureMarkdown, captureTargetNoteId } from '../src/notes/capture.ts'
import { sourceStatus } from '../src/notes/sourceStatus.ts'
import { createNoteSessionManager } from '../src/notes/session.ts'

let blockSeq = 0
const nextBlockId = () => `b${++blockSeq}`

const makeBlocks = (body, prev = [], forceNewRange) =>
  reconcileBlocks({
    noteId: 'n1',
    prev,
    body,
    docRevision: revisionOf(body),
    now: 1000,
    nextId: nextBlockId,
    forceNewRange
  })

test('parseBlocks groups structure and keeps fenced code intact', () => {
  const body = [
    '# 标题',
    '',
    '第一段',
    '仍属第一段',
    '',
    '- 项目一',
    '- 项目二',
    '',
    '> 引用一',
    '> 引用二',
    '',
    '```js',
    'const a = 1',
    '',
    'const b = 2',
    '```',
    '',
    '| a | b |',
    '| - | - |',
    '',
    '---'
  ].join('\n')
  const blocks = parseBlocks(body)
  const kinds = blocks.map((block) => block.kind)
  assert.deepEqual(kinds, [
    'heading', 'blank', 'paragraph', 'blank', 'list', 'blank', 'quote', 'blank',
    'code', 'blank', 'table', 'blank', 'hr'
  ])
  const code = blocks.find((block) => block.kind === 'code')
  assert.ok(code.text.startsWith('```js'))
  assert.ok(code.text.includes('const b = 2'))
  assert.ok(code.text.endsWith('```'))
  assert.equal(body.slice(code.from, code.to), code.text)
  const paragraph = blocks.find((block) => block.kind === 'paragraph')
  assert.equal(paragraph.text, '第一段\n仍属第一段')
})

test('blockAtOffset resolves the caret at a block end', () => {
  const body = '第一段\n\n第二段'
  const blocks = makeBlocks(body)
  const first = blocks.find((block) => block.text === '第一段')
  assert.equal(blockAtOffset(blocks, first.to)?.blockId, first.blockId)
  assert.equal(blockAtOffset(blocks, body.length)?.blockId, blocks.at(-1).blockId)
})

test('insertion after a middle paragraph stays between blocks, not at the end', () => {
  const body = '第一段内容\n\n第二段内容\n\n第三段内容'
  const blocks = makeBlocks(body)
  const first = blocks.find((block) => block.text === '第一段内容')
  const insertion = computeInsertion(body, blocks, { kind: 'after-block', blockId: first.blockId }, '> 摘录')
  assert.equal(insertion.fallback, false)
  assert.equal(insertion.body, '第一段内容\n\n> 摘录\n\n第二段内容\n\n第三段内容')
  assert.equal(insertion.body.slice(insertion.from, insertion.to), '> 摘录')
  assert.ok(!insertion.body.endsWith('> 摘录\n'))
})

test('insertion at an empty paragraph replaces the blank run', () => {
  const body = 'A\n\nB'
  const blocks = makeBlocks(body)
  const blank = blocks.find((block) => block.text.trim() === '')
  const insertion = computeInsertion(body, blocks, { kind: 'at-empty-block', blockId: blank.blockId }, '> X')
  assert.equal(insertion.fallback, false)
  assert.equal(insertion.body, 'A\n\n> X\n\nB')
})

test('insertion after a code block never enters the fence', () => {
  const body = '```js\nconst a = 1\n```\n\n尾段'
  const blocks = makeBlocks(body)
  const code = blocks.find((block) => block.text.startsWith('```js'))
  const insertion = computeInsertion(body, blocks, { kind: 'after-block', blockId: code.blockId }, '> 摘录')
  assert.equal(insertion.body, '```js\nconst a = 1\n```\n\n> 摘录\n\n尾段')
  assert.ok(insertion.body.indexOf('> 摘录') > insertion.body.indexOf('```', 3))
})

test('append is the only path that reaches the end of the document', () => {
  const body = 'A\n\nB'
  const blocks = makeBlocks(body)
  const insertion = computeInsertion(body, blocks, { kind: 'append' }, '> 摘录')
  assert.ok(insertion.body.startsWith('A\n\nB\n\n> 摘录'))
  assert.equal(insertion.fallback, false)
})

test('a stale block id falls back to the end and reports it', () => {
  const body = 'A\n\nB'
  const blocks = makeBlocks(body)
  const insertion = computeInsertion(body, blocks, { kind: 'after-block', blockId: 'gone' }, '> 摘录')
  assert.equal(insertion.fallback, true)
  assert.ok(insertion.body.endsWith('> 摘录\n'))
})

test('placementFromPosition prefers an empty block, else after the block', () => {
  const body = 'A\n\n\n\nB'
  const blocks = makeBlocks(body)
  const blank = blocks.find((block) => block.text.trim() === '')
  assert.deepEqual(placementFromPosition({ blockId: blank.blockId }, blocks), {
    kind: 'at-empty-block',
    blockId: blank.blockId
  })
  const first = blocks.find((block) => block.text === 'A')
  assert.deepEqual(placementFromPosition({ blockId: first.blockId }, blocks), {
    kind: 'after-block',
    blockId: first.blockId
  })
  assert.deepEqual(placementFromPosition(undefined, blocks), { kind: 'append' })
})

test('reconcile keeps block ids across an in-place edit', () => {
  const body = '标题\n\n第一段内容\n\n第二段内容\n'
  const first = makeBlocks(body)
  const edited = body.replace('第一段内容', '第一段内容补充')
  const second = makeBlocks(edited, first)
  assert.equal(second.length, first.length)
  second.forEach((block, index) => {
    assert.equal(block.blockId, first[index].blockId)
  })
  assert.equal(second[2].text, '第一段内容补充')
  assert.equal(second[2].docRevision, revisionOf(edited))
})

test('reconcile keeps surrounding ids when a new block is inserted', () => {
  const body = '标题\n\n第一段\n\n第二段\n'
  const first = makeBlocks(body)
  const next = '标题\n\n第一段\n\n新插入\n\n第二段\n'
  const from = next.indexOf('新插入')
  const second = makeBlocks(next, first, { from, to: from + '新插入'.length })
  const oldIds = new Set(first.map((block) => block.blockId))
  const inserted = second.find((block) => block.text === '新插入')
  assert.ok(inserted)
  assert.ok(!oldIds.has(inserted.blockId))
  const kept = second.filter((block) => oldIds.has(block.blockId)).map((block) => block.text)
  assert.ok(kept.includes('标题'))
  assert.ok(kept.includes('第一段'))
  assert.ok(kept.includes('第二段'))
})

test('a newly inserted duplicate never steals an existing block id', () => {
  const body = '> 引用\n\n正文'
  const first = makeBlocks(body)
  const next = '> 引用\n\n正文\n\n> 引用'
  const from = next.lastIndexOf('> 引用')
  const second = makeBlocks(next, first, { from, to: from + '> 引用'.length })
  const last = second.at(-1)
  assert.equal(last.text, '> 引用')
  assert.notEqual(last.blockId, first[0].blockId)
})

test('revisionOf changes with the body and is stable otherwise', () => {
  assert.equal(revisionOf('abc'), revisionOf('abc'))
  assert.notEqual(revisionOf('abc'), revisionOf('abd'))
  assert.notEqual(revisionOf('abc'), revisionOf('abc '))
})

const fakeInsertDeps = () => {
  const note = { id: 'n1', title: '笔记', body: '第一段\n\n第二段\n\n第三段\n' }
  const anchors = new Map()
  const links = new Map()
  const anchorKeys = new Map()
  let staged = null
  let position = {
    noteId: 'n1',
    blockId: undefined,
    blockOffset: 0,
    selection: { from: 0, to: 0 },
    docRevision: revisionOf(note.body),
    scrollTop: 0,
    updatedAt: 1
  }
  let blocks = reconcileBlocks({
    noteId: 'n1',
    prev: [],
    body: note.body,
    docRevision: revisionOf(note.body),
    now: 1,
    nextId: nextBlockId
  })
  const anchorService = {
    createOrReuse (input) {
      const key = `${input.resourceId}:${JSON.stringify(input.selector)}`
      if (anchorKeys.has(key)) return anchors.get(anchorKeys.get(key))
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
      anchorKeys.set(key, anchor.id)
      return anchor
    },
    getAnchor (id) {
      return anchors.get(id)
    },
    removeIfUnused (id) {
      const used = [...links.values()].some((link) => link.fromAnchorId === id || link.toAnchorId === id)
      if (!used) anchors.delete(id)
    }
  }
  const linkService = {
    createLink (link) {
      if (!anchors.has(link.fromAnchorId)) throw new Error('link source anchor not found')
      if (!anchors.has(link.toAnchorId)) throw new Error('link target anchor not found')
      links.set(link.id, link)
      return link
    },
    removeLink (id) {
      links.delete(id)
    },
    getLink (id) {
      return links.get(id)
    },
    getLinks () {
      return [...links.values()]
    }
  }
  let counter = 100
  const deps = {
    readNote: () => note,
    readBlocks: () => blocks,
    readPosition: () => position,
    readResource: (id) => ({ id, kind: 'document', sourceId: 'f1', availability: 'available', revision: '0' }),
    readNoteResourceId: () => 'r-note',
    stageNoteDocument: (doc) => { staged = doc },
    anchorService,
    linkService,
    now: () => 1000,
    nextId: () => `x${++counter}`
  }
  const apply = (doc) => {
    note.body = doc.body
    blocks = doc.blocks
    position = doc.position
    staged = null
  }
  return {
    deps,
    note,
    anchors,
    links,
    getBlocks: () => blocks,
    takeStaged: () => staged,
    applyStaged: () => { if (staged) apply(staged) }
  }
}

const captureCommand = (blocks, operationId = 'op-1') => ({
  targetNoteId: 'n1',
  placement: { kind: 'after-block', blockId: blocks[0].blockId },
  contentMarkdown: '> 摘录\n\n[来源：课件.pdf · 第 8 页](csref:NEW)',
  sourceCandidates: [{
    resourceId: 'r-doc',
    selector: { type: 'document-text', page: 8, quote: { exact: '摘录' } },
    relation: 'quotes',
    selected: true
  }],
  operationId
})

test('insertCapture stages body, block map and source link together', async () => {
  const harness = fakeInsertDeps()
  const service = createNoteInsertService(harness.deps)
  const result = await service.insertCapture(captureCommand(harness.getBlocks()), {})

  const staged = harness.takeStaged()
  assert.ok(staged, 'a note document should be staged')
  assert.equal(staged.noteId, 'n1')
  assert.ok(staged.body.startsWith('第一段\n\n> 摘录'))
  assert.ok(staged.body.includes('第二段'))
  assert.equal(result.createdLinkIds.length, 1)
  assert.equal(harness.links.size, 1)
  assert.ok(staged.body.includes(`csref:${result.createdLinkIds[0]}`))
  assert.equal(staged.body.slice(result.insertedRange.from, result.insertedRange.to).startsWith('> 摘录'), true)

  const insertedBlock = staged.blocks.find((block) => block.blockId === result.insertedBlockId)
  assert.ok(insertedBlock)
  assert.equal(insertedBlock.from, result.insertedRange.from)
  assert.equal(staged.position.blockId, result.insertedBlockId)
  assert.equal(staged.position.selection.from, result.insertedRange.to)
  assert.equal(result.placementFallback, false)
})

test('retrying the same operationId never inserts twice', async () => {
  const harness = fakeInsertDeps()
  const service = createNoteInsertService(harness.deps)
  const command = captureCommand(harness.getBlocks())
  const first = await service.insertCapture(command, {})
  harness.applyStaged()

  const second = await service.insertCapture(command, {})
  assert.equal(second, first)
  assert.equal(harness.takeStaged(), null, 'a retry must not stage another body change')
  assert.equal((harness.note.body.match(/> 摘录/g) ?? []).length, 1)
  assert.equal(harness.links.size, 1)
})

test('insertCapture stages nothing when a source resource is missing', async () => {
  const harness = fakeInsertDeps()
  const service = createNoteInsertService(harness.deps)
  const original = harness.note.body
  harness.deps.readResource = () => undefined
  await assert.rejects(
    () => service.insertCapture(captureCommand(harness.getBlocks(), 'op-bad'), {}),
    /来源资源不存在/
  )
  assert.equal(harness.takeStaged(), null)
  assert.equal(harness.links.size, 0)
  assert.equal(harness.note.body, original)
})

test('undo restores the body and drops links and anchors of that insert', async () => {
  const harness = fakeInsertDeps()
  const service = createNoteInsertService(harness.deps)
  const before = harness.note.body
  const result = await service.insertCapture(captureCommand(harness.getBlocks()), {})
  harness.applyStaged()
  assert.ok(harness.note.body !== before)
  assert.equal(harness.links.size, 1)

  const restored = await service.undo('op-1', {})
  assert.ok(restored)
  assert.equal(restored.body, before)
  assert.equal(harness.links.size, 0)
  assert.equal(harness.anchors.size, 0)
  assert.equal(result.createdLinkIds.length, 1)
})

test('buildCaptureMarkdown keeps the quote block and optional source line', () => {
  const withSource = buildCaptureMarkdown({
    quote: 'Self-Attention allows each token to attend.\nSecond line.',
    label: 'Transformer.pdf · 第 8 页',
    withSource: true
  })
  assert.ok(withSource.startsWith('> Self-Attention'))
  assert.ok(withSource.includes('> Second line.'))
  assert.ok(withSource.endsWith('[来源：Transformer.pdf · 第 8 页](csref:NEW)'))

  const plain = buildCaptureMarkdown({ quote: '只有原文', withSource: false })
  assert.equal(plain, '> 只有原文')
})

test('captureTargetNoteId falls back when the remembered note is gone', () => {
  const notes = [{ id: 'a' }, { id: 'b' }]
  assert.equal(captureTargetNoteId(notes, 'b', 'a'), 'a')
  assert.equal(captureTargetNoteId(notes, 'b', 'deleted'), 'b')
  assert.equal(captureTargetNoteId(notes, null, null), 'a')
  assert.equal(captureTargetNoteId([], null, null), null)
})

test('sourceStatus reports ok, deleted note and missing file without re-pointing', () => {
  const base = {
    resources: {
      'r-doc': { id: 'r-doc', kind: 'document', sourceId: 'f1', title: '第五讲.pdf', revision: '0', availability: 'available' },
      'r-note': { id: 'r-note', kind: 'note', sourceId: 'note-1', title: '笔记', revision: '0', availability: 'available' }
    },
    anchors: {
      'a-note': {
        id: 'a-note', resourceId: 'r-note',
        origin: { revision: 'r1', selector: { type: 'note-block', blockId: 'b1' } },
        accepted: { revision: 'r1', selector: { type: 'note-block', blockId: 'b1' } }
      },
      'a-doc': {
        id: 'a-doc', resourceId: 'r-doc',
        origin: { revision: '0', selector: { type: 'document-text', page: 8, quote: { exact: '原文' } } },
        accepted: { revision: '0', selector: { type: 'document-text', page: 8, quote: { exact: '原文' } } }
      }
    },
    links: {
      'link-1': { id: 'link-1', fromAnchorId: 'a-note', toAnchorId: 'a-doc', relation: 'quotes', createdBy: 'user', verification: 'user_confirmed', createdAt: 1 }
    },
    notes: [{ id: 'note-1' }],
    files: [{ id: 'f1' }],
    refs: []
  }
  assert.equal(sourceStatus('link-1', base).status, 'ok')
  assert.equal(sourceStatus('link-1', base).label, '第五讲.pdf · 第 8 页')

  const relocated = structuredClone(base)
  relocated.anchors['a-doc'].accepted.revision = '0-new'
  assert.equal(sourceStatus('link-1', relocated).status, 'relocated')

  const deletedNote = structuredClone(base)
  deletedNote.notes = []
  deletedNote.links['link-1'].toAnchorId = 'a-note'
  assert.equal(sourceStatus('link-1', deletedNote).status, 'deleted')

  const missing = structuredClone(base)
  missing.files = []
  missing.resources['r-doc'].availability = 'missing'
  assert.equal(sourceStatus('link-1', missing).status, 'missing')

  assert.equal(sourceStatus('gone', base).status, 'orphaned')
})

test('session undo restores the body from a checkpoint', () => {
  let now = 0
  const manager = createNoteSessionManager({ now: () => now, nextId: nextBlockId })
  manager.ensure('n1', 'A')
  now = 1000
  manager.syncBody('n1', 'A\n\nB')
  const entry = manager.undo('n1')
  assert.equal(entry.body, 'A')
  assert.equal(manager.get('n1').body, 'A')
})

test('a stale writing position falls back to its block, not the old offset', () => {
  const body = '第一段\n\n第二段\n\n第三段'
  const blocks = reconcileBlocks({
    noteId: 'n1', prev: [], body, docRevision: revisionOf(body), now: 1, nextId: nextBlockId
  })
  const second = blocks.find((block) => block.text === '第二段')
  const stale = {
    noteId: 'n1',
    blockId: second.blockId,
    blockOffset: 99,
    selection: { from: 99, to: 99 },
    docRevision: revisionOf('旧正文'),
    scrollTop: 0,
    updatedAt: 1
  }
  const manager = createNoteSessionManager({ readPosition: () => stale, now: () => 1, nextId: nextBlockId })
  manager.ensure('n1', body, blocks)
  const restored = manager.restore('n1', body)
  assert.equal(restored.selection.from, second.from + second.text.length)
  assert.equal(restored.selection.to, second.from + second.text.length)
})

test('session keeps a position per note and tracks the block at the caret', () => {
  const manager = createNoteSessionManager({ now: () => 1, nextId: nextBlockId })
  const body = '第一段\n\n第二段'
  manager.ensure('n1', body)
  manager.setSelection('n1', 1, 1)
  const first = manager.positionOf('n1')
  assert.equal(first.docRevision, revisionOf(body))
  assert.ok(first.blockId)
  manager.setSelection('n1', body.length, body.length)
  const last = manager.positionOf('n1')
  assert.notEqual(last.blockId, first.blockId)
})
