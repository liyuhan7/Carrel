import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalize, parseAnswer, locateQuote } from '../src/lib/verify.ts'

const pages = [
  '分组密码将明文划分为固定长度的数据块，在密钥控制下执行可逆变换。',
  '分组密码是一种对称密码体制，加密与解密使用相同密钥。',
  'Why fixed-length blocks matter. Fixed-length blocks define the input space.'
]

test('normalize ignores whitespace, punctuation and width differences', () => {
  assert.equal(normalize('分组密码，将明文 划分'), normalize('分组密码将明文划分'))
  assert.equal(normalize('ＡＢＣ．'), normalize('abc'))
})

test('parseAnswer verifies a real quote and strips cite lines', () => {
  const raw = '分组密码把明文分成固定长度的块。[[p1]]\n\n@cite 1 | 分组密码将明文划分为固定长度的数据块'
  const parsed = parseAnswer(raw, pages)
  assert.equal(parsed.citations.length, 1)
  assert.equal(parsed.citations[0].page, 1)
  assert.equal(parsed.citations[0].verified, true)
  assert.equal(parsed.citations[0].corrected, false)
  assert.ok(parsed.content.includes('[[p1]]'))
  assert.ok(!parsed.content.includes('@cite'))
})

test('parseAnswer corrects the page when the quote lives elsewhere', () => {
  const raw = '见第 3 页。[[p3]]\n@cite 1 | Fixed-length blocks define the input space.'
  const parsed = parseAnswer(raw, pages)
  assert.equal(parsed.citations.length, 1)
  assert.equal(parsed.citations[0].page, 3)
  assert.equal(parsed.citations[0].corrected, true)
})

test('parseAnswer rejects an invented quote instead of fabricating a source', () => {
  const raw = '这段话说……\n@cite 2 | 这是一段模型编造出来的原文'
  const parsed = parseAnswer(raw, pages)
  assert.equal(parsed.citations.length, 0)
  assert.ok(!parsed.content.includes('@cite'))
})

test('parseAnswer deduplicates repeated citations', () => {
  const raw = 'a\n@cite 2 | 分组密码是一种对称密码体制\n@cite 2 | 分组密码是一种对称密码体制，加密与解密使用相同密钥。'
  const parsed = parseAnswer(raw, pages)
  assert.equal(parsed.citations.length, 2)
})

test('locateQuote ignores quotes that are too short to be evidence', () => {
  assert.equal(locateQuote('分组', pages), null)
})
