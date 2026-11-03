import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useStore } from '../store'
import type { ChatMessage, ContextScope } from '../types'
import { activeRoute, authReady, modelOptions, supportsImage } from '../lib/providers'
import { renderAnswer } from '../lib/markdown'
import { Popover } from './Popover'
// >>> integration:note-capture-editing
import { uid } from '../lib/format'
import { capturePlacement, captureTargetNoteId, stripCiteMarkers } from '../notes/capture'
import { CaptureDraftPanel } from '../notes/CaptureDraftPanel'
import { useNoteUi } from '../notes/ui'
import type { NoteSourceCandidate } from '../notes/contracts'
// <<< integration:note-capture-editing

const SCOPE_LABEL: Record<ContextScope, string> = {
  selection: '选中内容 + 当前页',
  page: '当前页',
  file: '当前文件'
}

export function AiPane ({ collapsed, onExpand, onCollapse }: {
  collapsed: boolean
  onExpand: () => void
  onCollapse: () => void
}) {
  const messages = useStore((s) => s.messages)
  const streaming = useStore((s) => s.streaming)
  const connections = useStore((s) => s.connections)
  const activeModel = useStore((s) => s.activeModel)
  const workspace = useStore((s) => s.workspace)
  const files = useStore((s) => s.files)
  const selection = useStore((s) => s.selection)
  const composerFocus = useStore((s) => s.composerFocus)
  const sendQuestion = useStore((s) => s.sendQuestion)
  const stopAnswer = useStore((s) => s.stopAnswer)
  const setContextScope = useStore((s) => s.setContextScope)
  const setActiveModel = useStore((s) => s.setActiveModel)
  const setAttachPageImage = useStore((s) => s.setAttachPageImage)
  const setSelection = useStore((s) => s.setSelection)
  const openSettings = useStore((s) => s.openSettings)

  const [input, setInput] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const activeFile = files.find((file) => file.id === workspace.activeTab)
  const page = activeFile ? workspace.pages[activeFile.id] ?? 1 : 1
  const active = activeRoute(connections, activeModel)
  const options = modelOptions(connections)
  const scope = workspace.contextScope
  const last = messages[messages.length - 1]

  useEffect(() => {
    if (composerFocus > 0) inputRef.current?.focus()
  }, [composerFocus])

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 160
    if (nearBottom) list.scrollTop = list.scrollHeight
  }, [last?.content, messages.length])

  const send = () => {
    const question = input.trim()
    if (!question) return
    setInput('')
    if (inputRef.current) inputRef.current.style.height = 'auto'
    void sendQuestion(question)
  }

  if (collapsed) {
    return (
      <button type="button" className="pane-rail" onClick={onExpand} title="展开 AI 学习助手">
        <span>AI 学习助手</span>
      </button>
    )
  }

  return (
    <section className="pane ai-pane">
      <div className="pane-head">
        <span className="pane-title">AI 学习助手</span>
        <Popover
          align="right"
          width={300}
          trigger={() => (
            <span className="model-chip">
              {active ? `${active.connection.name} · ${active.model.displayName}` : '选择模型'}
            </span>
          )}
        >
          {options.map(({ connection, model }) => (
            <button
              key={`${connection.id}/${model.modelId}`}
              type="button"
              className={`menu-item${connection.id === active?.connection.id && model.modelId === active.model.modelId ? ' is-active' : ''}`}
              onClick={() => {
                if (!authReady(connection)) {
                  openSettings(connection.id)
                  return
                }
                setActiveModel(connection.id, model.modelId)
              }}
            >
              <span className="menu-name">{model.displayName}</span>
              <span className="menu-meta">
                {authReady(connection) ? connection.name : `${connection.name} · 未配置`}
              </span>
            </button>
          ))}
          <div className="menu-sep" />
          <button type="button" className="menu-item" onClick={() => openSettings()}>
            管理模型服务…
          </button>
        </Popover>
        <span className="tool-spacer" />
        <button type="button" className="icon-btn" title="收起 AI 区" onClick={onCollapse}>
          ›
        </button>
      </div>

      <div className="context-strip">
        <span className="context-label">上下文</span>
        <span className="context-value">
          {activeFile ? `${activeFile.name} · 第 ${page} 页` : '没有打开的资料'}
          {scope === 'file' ? ' · 整份文件' : scope === 'selection' ? ' · 选中内容优先' : ''}
        </span>
        <Popover align="right" width={240} trigger={() => <span className="context-change">调整</span>}>
          {(['selection', 'page', 'file'] as ContextScope[]).map((item) => (
            <button
              key={item}
              type="button"
              className={`menu-item${scope === item ? ' is-active' : ''}`}
              onClick={() => setContextScope(item)}
            >
              <span className="menu-name">{SCOPE_LABEL[item]}</span>
              {scope === item ? <span className="menu-check">✓</span> : null}
            </button>
          ))}
        </Popover>
      </div>

      <div className="chat" ref={listRef}>
        {messages.length === 0 ? (
          <div className="chat-empty">
            <p>{activeFile ? '选中正文提问，或从下面的问题开始。' : '先在左侧打开一份资料。'}</p>
            <div className="suggestions">
              {['解释这一页的核心概念', '这一页有哪些容易混淆的地方', '帮我总结本页要点'].map((question) => (
                <button key={question} type="button" disabled={!activeFile} onClick={() => void sendQuestion(question)}>
                  {question}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => <Message key={message.id} message={message} />)
        )}
      </div>

      <div className="composer">
        {selection && activeFile && selection.fileId === activeFile.id ? (
          <div className="ctx-row">
            <span className="ctx-chip">
              第 {page} 页 · 选中 {selection.text.length} 字
              <button type="button" aria-label="移除选中内容" onClick={() => setSelection(null)}>
                ✕
              </button>
            </span>
          </div>
        ) : null}
        <div className="composer-box">
          <textarea
            ref={inputRef}
            rows={2}
            value={input}
            disabled={!activeFile}
            placeholder={activeFile ? `针对第 ${page} 页提问，Enter 发送` : '先打开一份资料'}
            onChange={(event) => {
              setInput(event.target.value)
              event.target.style.height = 'auto'
              event.target.style.height = `${Math.min(150, event.target.scrollHeight)}px`
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send()
              }
            }}
          />
          <div className="composer-foot">
            <div className="composer-meta">
              {activeFile?.kind === 'pdf' && supportsImage(active?.model) ? (
                <label className="image-toggle">
                  <input
                    type="checkbox"
                    checked={workspace.attachPageImage}
                    onChange={(event) => setAttachPageImage(event.target.checked)}
                  />
                  附本页截图
                </label>
              ) : null}
              <Popover align="left" width={230} trigger={() => <span className="scope-btn">{SCOPE_LABEL[scope]}</span>}>
                {(['selection', 'page', 'file'] as ContextScope[]).map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`menu-item${scope === item ? ' is-active' : ''}`}
                    onClick={() => setContextScope(item)}
                  >
                    <span className="menu-name">{SCOPE_LABEL[item]}</span>
                    {scope === item ? <span className="menu-check">✓</span> : null}
                  </button>
                ))}
              </Popover>
              <span className="muted">{active?.connection.name}</span>
            </div>
            {streaming ? (
              <button type="button" className="btn btn-small" onClick={stopAnswer}>
                停止生成
              </button>
            ) : (
              <button type="button" className="btn btn-primary btn-small" disabled={!input.trim() || !activeFile} onClick={send}>
                发送
              </button>
            )}
          </div>
        </div>
      </div>
      {/* >>> integration:note-capture-editing */}
      <CaptureDraftPanel />
      {/* <<< integration:note-capture-editing */}
    </section>
  )
}

function Message ({ message }: { message: ChatMessage }) {
  const files = useStore((s) => s.files)
  const openFile = useStore((s) => s.openFile)
  const setPage = useStore((s) => s.setPage)
  const focusOn = useStore((s) => s.focusOn)
  const setReaderPanel = useStore((s) => s.setReaderPanel)
  // >>> integration:note-capture-editing
  const [selectedText, setSelectedText] = useState('')
  // <<< integration:note-capture-editing
  const notify = useStore((s) => s.notify)

  const isUser = message.role === 'user'
  const citations = message.citations ?? []
  const inlinePages = Array.from(message.content.matchAll(/\[\[\s*p\s*(\d+)\s*\]\]/gi)).map((match) => Number(match[1]))
  const unverified = inlinePages.filter((page) => !citations.some((citation) => citation.page === page && citation.verified)).length

  const openCitation = async (page: number) => {
    if (!message.fileId) return
    const file = files.find((item) => item.id === message.fileId)
    if (!file) {
      notify('来源资料已不在资料库中', 'error')
      return
    }
    const citation = citations.find((item) => item.page === page)
    if (!citation?.verified) notify(`第 ${page} 页没有可核实的原文摘录`)
    await openFile(file.id)
    setPage(file.id, page)
    setReaderPanel('doc')
    focusOn(file.id, page, citation?.quote ?? '')
  }

  const onClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const chip = (event.target as HTMLElement).closest('button.cite')
    if (chip) void openCitation(Number(chip.getAttribute('data-page')))
  }

  // >>> integration:note-capture-editing
  // Selecting part of an answer only prepares a draft; nothing is written yet.
  const onBodyMouseUp = () => {
    const text = window.getSelection()?.toString().trim() ?? ''
    setSelectedText(text)
  }

  const startDraft = async (raw: string) => {
    const text = stripCiteMarkers(raw)
    if (!text) {
      notify('先选择回答中的一段内容', 'error')
      return
    }
    const state = useStore.getState()
    const targetId = captureTargetNoteId(state.notes, state.workspace.activeNoteId, useNoteUi.getState().lastTargetNoteId)
    if (!targetId) {
      notify('先新建一份笔记', 'error')
      return
    }
    const conversation = await state.ensureResource({ kind: 'conversation', sourceId: 'chat', title: 'AI 学习助手' })
    const candidates: NoteSourceCandidate[] = [{
      resourceId: conversation.id,
      selector: { type: 'message', messageId: message.id, quote: { exact: text } },
      relation: 'derived_from',
      selected: true
    }]
    const file = state.files.find((item) => item.id === message.fileId)
    for (const citation of citations.filter((item) => item.verified)) {
      if (!file) break
      const resource = await state.ensureResource({ kind: 'document', sourceId: file.id, title: file.name })
      candidates.push({
        resourceId: resource.id,
        selector: { type: 'document-text', page: citation.page, quote: { exact: citation.quote } },
        relation: 'derived_from',
        selected: true
      })
    }
    useNoteUi.getState().openDraft({
      id: uid(),
      targetNoteId: targetId,
      content: text,
      placement: capturePlacement(state.notePositions[targetId], state.noteBlocks[targetId] ?? []),
      sourceCandidates: candidates,
      createdAt: Date.now()
    })
  }
  // <<< integration:note-capture-editing

  return (
    <div className={`msg msg-${message.role}`}>
      <div className="msg-head">
        {isUser ? null : <span className="msg-who">{`${message.providerName ?? 'AI'}${message.model ? ` · ${message.model}` : ''}`}</span>}
        {message.contextLabel ? <span className="msg-context">{message.contextLabel}</span> : null}
      </div>
      {message.content ? (
        <div
          className="msg-body"
          onClick={onClick}
          // >>> integration:note-capture-editing
          onMouseUp={onBodyMouseUp}
          // <<< integration:note-capture-editing
          dangerouslySetInnerHTML={{ __html: renderAnswer(message.content, citations) }}
        />
      ) : message.status === 'streaming' ? (
        <div className="msg-body msg-thinking">正在阅读资料…</div>
      ) : null}
      {message.status === 'error' ? <p className="msg-error">{message.error}</p> : null}
      {message.status === 'stopped' ? <p className="msg-note">已停止生成</p> : null}
      {!isUser && message.status === 'done' ? (
        <div className="msg-foot">
          {/* >>> integration:note-capture-editing */}
          <button type="button" className="link" onClick={() => void startDraft(selectedText || message.content)}>
            {selectedText ? '整理选中片段到笔记' : '整理到笔记'}
          </button>
          {selectedText ? (
            <button type="button" className="link" onClick={() => setSelectedText('')}>
              取消选择
            </button>
          ) : null}
          {/* <<< integration:note-capture-editing */}
          <button
            type="button"
            className="link"
            onClick={() => {
              void navigator.clipboard.writeText(message.content.replace(/\[\[\s*p\s*\d+\s*\]\]/gi, ''))
              notify('已复制回答')
            }}
          >
            复制
          </button>
          {unverified > 0 ? <span className="msg-warn">{unverified} 处引用未能核实</span> : null}
        </div>
      ) : null}
    </div>
  )
}
