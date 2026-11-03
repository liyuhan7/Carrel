// Capture helpers shared by the reader entry, the notes entry and AI drafts.
// Pure functions only: no React, no store access.

import type { CapturePlacement, NoteBlock, NoteSourceCandidate, WritingPosition } from './contracts'
import { placementFromPosition } from './placement.ts'

export interface CaptureSource {
  fileId: string
  fileName: string
  page: number
  text: string
}

/** Removes the inline `[[pN]]` citation markers from an AI answer. */
export function stripCiteMarkers (text: string): string {
  return text.replace(/\[\[\s*p\s*\d+\s*\]\]/gi, '').replace(/\n{3,}/g, '\n\n').trim()
}

export function sourceLabel (fileName: string, page: number): string {
  return `${fileName} · 第 ${page} 页`
}

/** Quote block plus an optional inline `csref:` source line. */
export function buildCaptureMarkdown (input: {
  quote: string
  label?: string
  withSource: boolean
}): string {
  const quote = input.quote.trim()
  const quoted = quote
    .split('\n')
    .map((line) => (line.trim() ? `> ${line}` : '>'))
    .join('\n')
  if (!input.withSource || !input.label) return quoted
  return `${quoted}\n\n[来源：${input.label}](csref:NEW)`
}

export function captureTargetNoteId (
  notes: Array<{ id: string }>,
  activeNoteId: string | null,
  rememberedNoteId: string | null
): string | null {
  const remembered = rememberedNoteId && notes.some((note) => note.id === rememberedNoteId)
    ? rememberedNoteId
    : null
  if (remembered) return remembered
  if (activeNoteId && notes.some((note) => note.id === activeNoteId)) return activeNoteId
  return notes[0]?.id ?? null
}

/** Placement implied by the note's last persisted writing position. */
export function capturePlacement (
  position: WritingPosition | undefined,
  blocks: NoteBlock[]
): CapturePlacement {
  return placementFromPosition(position, blocks)
}

/** One candidate per verified citation, all `derived_from` by default. */
export function draftCandidates (
  citations: Array<{ page: number; quote: string; verified: boolean }> | undefined
): Array<{ page: number; quote: string }> {
  return (citations ?? []).filter((citation) => citation.verified)
}

export function sourceCandidate (
  resourceId: string,
  selector: NoteSourceCandidate['selector'],
  relation: NoteSourceCandidate['relation'],
  selected = true
): NoteSourceCandidate {
  return { resourceId, selector, relation, selected }
}
