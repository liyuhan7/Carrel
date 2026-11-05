import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import {
  CAPABILITY_LABEL, CUSTOM_PRESET_ID, PROTOCOL_LABEL, authLabel, describeModel,
  enabledModels, modelRows, presetOf, routeOf
} from '../lib/providers'
import type { AuthMethod, CredentialSource, DeviceCode, ProviderConnection, SourceDetection } from '../types'

const AUTH_LABEL: Record<AuthMethod, string> = {
  'api-key': 'API Key',
  oauth: '账号授权',
  'external-cli': '本机 CLI',
  copilot: 'GitHub 登录',
  none: '无需凭证'
}

const SOURCE_LABEL: Record<CredentialSource, string> = {
  'claude-code': 'Claude Code',
  codex: 'Codex CLI',
  grok: 'Grok Build'
}

function expiryLabel (expiresAt?: number): string {
  if (!expiresAt) return ''
  const date = new Date(expiresAt)
  const stamp = `${date.getMonth() + 1}-${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return expiresAt < Date.now() ? `（${stamp} 已过期）` : `（有效至 ${stamp}）`
}

/** Sidebar sections follow the catalog order (订阅 / 直连 / 套餐). */
function groupConnections (connections: ProviderConnection[]): Array<[string, ProviderConnection[]]> {
  const sections = new Map<string, ProviderConnection[]>()
  for (const connection of connections) {
    const group = presetOf(connection)?.group ?? '自定义'
    sections.set(group, [...(sections.get(group) ?? []), connection])
  }
  return [...sections.entries()]
}

export function SettingsModal () {
  const connections = useStore((s) => s.connections)
  const activeModel = useStore((s) => s.activeModel)
  const closeSettings = useStore((s) => s.closeSettings)
  const updateConnection = useStore((s) => s.updateConnection)
  const addConnection = useStore((s) => s.addConnection)
  const removeConnection = useStore((s) => s.removeConnection)
  const toggleModel = useStore((s) => s.toggleModel)
  const addModel = useStore((s) => s.addModel)
  const setDefaultModel = useStore((s) => s.setDefaultModel)
  const setActiveModel = useStore((s) => s.setActiveModel)
  const saveKey = useStore((s) => s.saveKey)
  const clearKey = useStore((s) => s.clearKey)
  const setAuthMethod = useStore((s) => s.setAuthMethod)
  const setOAuthClientSecret = useStore((s) => s.setOAuthClientSecret)
  const beginOAuth = useStore((s) => s.beginOAuth)
  const signOut = useStore((s) => s.signOut)
  const detectSources = useStore((s) => s.detectSources)
  const importSource = useStore((s) => s.importSource)
  const refreshSubscription = useStore((s) => s.refreshSubscription)
  const copilotBegin = useStore((s) => s.copilotBegin)
  const copilotPoll = useStore((s) => s.copilotPoll)
  const refreshModels = useStore((s) => s.refreshModels)
  const notify = useStore((s) => s.notify)

  const requested = useStore((s) => s.settingsConnection)
  const [selected, setSelected] = useState(requested ?? activeModel.connectionId)
  const [key, setKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [newModel, setNewModel] = useState('')
  const [detections, setDetections] = useState<Record<string, SourceDetection>>({})
  const [copilot, setCopilot] = useState<DeviceCode | null>(null)
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  const connection = connections.find((item) => item.id === selected) ?? connections[0]
  const preset = presetOf(connection)
  const models = enabledModels(connection)
  const rows = modelRows(connection)
  const enabledIds = connection.enabledModelIds
  const defaultModel = models.find((model) => model.modelId === connection.defaultModelId) ?? models[0]
  const isCustom = connection.presetId === CUSTOM_PRESET_ID
  const authMethods = preset?.auth ?? ['api-key']

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeSettings()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [closeSettings])

  useEffect(() => {
    setKey('')
    setResult(null)
    setNewModel('')
    setCopilot(null)
    if (pollTimer.current) clearInterval(pollTimer.current)
    if (preset?.sources?.length) void detectSources(preset.sources).then(setDetections)
    // A configured provider's own list outranks the bundled snapshot, so pull it once.
    if (preset?.modelList === 'api' && connection.hasKey && !connection.models?.length) {
      void refreshModels(connection.id, true)
    }
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current)
    }
  }, [selected])

  const test = async () => {
    if (!defaultModel) {
      notify('先启用一个模型再测试连接', 'error')
      return
    }
    setTesting(true)
    setResult(null)
    try {
      const response = await window.cs.testProvider({
        route: routeOf(connection, defaultModel),
        apiKey: key.trim() || undefined
      })
      setResult(response)
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message })
    } finally {
      setTesting(false)
    }
  }

  const startCopilot = async () => {
    const device = await copilotBegin()
    if (!device.ok || !device.deviceCode) {
      notify(device.message || '无法开始 GitHub 登录', 'error')
      return
    }
    setCopilot(device)
    pollTimer.current = setInterval(async () => {
      const response = await copilotPoll(connection.id, device.deviceCode!)
      if (response.status === 'ok') {
        if (pollTimer.current) clearInterval(pollTimer.current)
        setCopilot(null)
      } else if (response.status === 'error') {
        if (pollTimer.current) clearInterval(pollTimer.current)
        setCopilot(null)
        notify(response.message || 'GitHub 授权失败', 'error')
      }
    }, Math.max(5, device.interval ?? 5) * 1000)
  }

  const credentialPane = () => {
    if (connection.authMethod === 'none') {
      return null
    }
    if (connection.authMethod === 'api-key') {
      return (
        <>
          <label className="field">
            <span>API Key</span>
            <input
              type="password"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder={connection.hasKey ? '已保存，输入新值可替换' : '粘贴 API Key'}
            />
          </label>
          <div className="form-row">
            <button type="button" className="btn btn-primary" disabled={!key.trim()} onClick={() => void saveKey(connection.id, key.trim()).then(() => {
              setKey('')
              notify('密钥已保存到系统安全存储')
            })}>
              保存密钥
            </button>
            {connection.hasKey ? (
              <button type="button" className="btn btn-ghost" onClick={() => void clearKey(connection.id)}>
                移除密钥
              </button>
            ) : null}
            <span className="hint">{authLabel(connection)}</span>
          </div>
        </>
      )
    }
    if (connection.authMethod === 'oauth') {
      return (
        <>
          <label className="field">
            <span>OAuth 客户端 ID</span>
            <input
              value={connection.oauthClientId ?? ''}
              onChange={(event) => updateConnection(connection.id, { oauthClientId: event.target.value })}
              placeholder="在服务商控制台创建桌面应用后填入"
            />
          </label>
          {connection.protocol === 'google-generate-content' ? (
            <label className="field">
              <span>Google Cloud 项目 ID（配额归属）</span>
              <input
                value={connection.oauthProjectId ?? ''}
                onChange={(event) => updateConnection(connection.id, { oauthProjectId: event.target.value })}
                placeholder="my-project"
              />
            </label>
          ) : null}
          <label className="field">
            <span>客户端密钥（部分服务需要）</span>
            <input
              type="password"
              defaultValue=""
              placeholder={connection.hasOAuthClient ? '已保存' : '可留空'}
              onChange={(event) => {
                if (event.target.value) void setOAuthClientSecret(connection.id, event.target.value)
              }}
            />
          </label>
          <div className="form-row">
            <button type="button" className="btn btn-primary" onClick={() => void beginOAuth(connection.id)}>
              在浏览器中登录
            </button>
            {connection.hasOAuth ? (
              <button type="button" className="btn btn-ghost" onClick={() => void signOut(connection.id)}>
                退出登录
              </button>
            ) : null}
            <span className="hint">{connection.hasOAuth ? '已授权' : '未登录'}</span>
          </div>
        </>
      )
    }
    if (connection.authMethod === 'external-cli') {
      return (
        <>
          {(preset?.sources ?? []).map((source) => {
            const found = detections[source]
            return (
              <div className="auth-row" key={source}>
                <span>{SOURCE_LABEL[source]}</span>
                <span className="hint">{found?.found ? found.account || '已找到登录信息' : '未找到本机登录'}</span>
                <button
                  type="button"
                  className="btn btn-small"
                  disabled={!found?.found}
                  onClick={() => void importSource(connection.id, source)}
                >
                  导入
                </button>
              </div>
            )
          })}
          <div className="form-row">
            <span className="hint">
              {connection.hasSubscription
                ? `已导入${connection.subscriptionAccount ? ` · ${connection.subscriptionAccount}` : ''}${expiryLabel(connection.subscriptionExpiresAt)}`
                : '未导入凭证'}
            </span>
            <span className="tool-spacer" />
            {connection.hasSubscription ? (
              <>
                <button type="button" className="btn btn-small" onClick={() => void refreshSubscription(connection.id)}>
                  刷新凭证
                </button>
                <button type="button" className="btn btn-ghost" onClick={() => void signOut(connection.id)}>
                  移除凭证
                </button>
              </>
            ) : null}
          </div>
        </>
      )
    }
    return (
      <>
        {copilot ? (
          <div className="device-code">
            <p>在 GitHub 页面输入代码：</p>
            <code>{copilot.userCode}</code>
          </div>
        ) : null}
        <div className="form-row">
          <button type="button" className="btn btn-primary" onClick={() => void startCopilot()}>
            {copilot ? '重新获取代码' : '使用 GitHub 登录'}
          </button>
          {connection.hasSubscription ? (
            <button type="button" className="btn btn-ghost" onClick={() => void signOut(connection.id)}>
              退出登录
            </button>
          ) : null}
          <span className="hint">{connection.hasSubscription ? `已授权${connection.subscriptionAccount ? ` · ${connection.subscriptionAccount}` : ''}` : '未授权'}</span>
        </div>
      </>
    )
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeSettings()
      }}
    >
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="modal-head">
          <h2 id="settings-title">模型服务</h2>
          <button type="button" className="icon-btn" aria-label="关闭" onClick={closeSettings}>
            ✕
          </button>
        </header>

        <div className="modal-body settings-body">
          <aside className="provider-list" aria-label="模型服务列表">
            {groupConnections(connections).map(([group, items]) => (
              <div key={group}>
                <p className="provider-group">{group}</p>
                {items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`provider-item${item.id === connection.id ? ' is-active' : ''}`}
                    onClick={() => setSelected(item.id)}
                  >
                    <span className="provider-name">{item.name}</span>
                    {item.id === activeModel.connectionId ? <span className="badge">当前</span> : null}
                    {item.authMethod !== 'none' && !item.hasKey && !item.hasOAuth && !item.hasSubscription ? (
                      <span className="dot" title="未配置凭证" />
                    ) : null}
                  </button>
                ))}
              </div>
            ))}
            <button type="button" className="provider-item provider-add" onClick={() => setSelected(addConnection())}>
              + 自定义服务
            </button>
          </aside>

          <div className="provider-form">
            <h3>
              {connection.name} <span className="badge">{PROTOCOL_LABEL[connection.protocol]}</span>
            </h3>

            {isCustom ? (
              <label className="field">
                <span>名称</span>
                <input
                  value={connection.name}
                  onChange={(event) => updateConnection(connection.id, { name: event.target.value })}
                  placeholder="例如 公司网关"
                />
              </label>
            ) : null}

            <label className="field">
              <span>接口地址</span>
              <input
                value={connection.baseUrl}
                onChange={(event) => updateConnection(connection.id, { baseUrl: event.target.value })}
                placeholder="https://api.example.com/v1"
              />
            </label>

            {authMethods.length > 1 ? (
              <div className="auth-tabs" role="group" aria-label="凭证方式">
                {authMethods.map((method) => (
                  <button
                    key={method}
                    type="button"
                    aria-pressed={connection.authMethod === method}
                    onClick={() => setAuthMethod(connection.id, method)}
                  >
                    {AUTH_LABEL[method]}
                  </button>
                ))}
              </div>
            ) : null}

            {credentialPane()}

            <div className="form-row">
              <button type="button" className="btn" disabled={testing} onClick={() => void test()}>
                {testing ? '测试中…' : '测试连接'}
              </button>
              {defaultModel ? (
                <button
                  type="button"
                  className="btn"
                  disabled={activeModel.connectionId === connection.id && activeModel.modelId === defaultModel.modelId}
                  onClick={() => {
                    setActiveModel(connection.id, defaultModel.modelId)
                    notify(`已切换到 ${defaultModel.displayName}`)
                  }}
                >
                  {activeModel.connectionId === connection.id && activeModel.modelId === defaultModel.modelId ? '正在使用' : '使用默认模型'}
                </button>
              ) : null}
            </div>

            {result ? <p className={result.ok ? 'result is-ok' : 'result is-error'}>{result.message}</p> : null}

            <label className="field">
              <span>默认模型</span>
              <select
                value={defaultModel?.modelId ?? ''}
                disabled={!models.length}
                onChange={(event) => setDefaultModel(connection.id, event.target.value)}
              >
                {models.map((model) => (
                  <option key={model.modelId} value={model.modelId}>
                    {model.displayName}
                  </option>
                ))}
              </select>
            </label>

            <div className="model-head">
              <span>模型</span>
              <span className="tool-spacer" />
              <button type="button" className="btn btn-small" onClick={() => void refreshModels(connection.id)}>
                拉取模型
              </button>
            </div>
            <div className="model-list">
              {rows.map((model) => (
                <div className="model-row" key={model.modelId}>
                  <input
                    id={`model-${connection.id}-${model.modelId}`}
                    type="checkbox"
                    checked={enabledIds.includes(model.modelId)}
                    onChange={(event) => toggleModel(connection.id, model.modelId, event.target.checked)}
                  />
                  <label className="model-name" htmlFor={`model-${connection.id}-${model.modelId}`}>
                    {model.displayName}
                  </label>
                  <span className="model-meta">
                    {model.contextWindow ? `${Math.round(model.contextWindow / 1000)}K` : ''}
                    {model.capabilities.length ? `${model.contextWindow ? ' · ' : ''}${model.capabilities.map((cap) => CAPABILITY_LABEL[cap]).join(' · ')}` : ''}
                  </span>
                  {model.provenance !== 'preset' ? <span className="badge">{model.provenance === 'user' ? '手填' : '发现'}</span> : null}
                  {connection.defaultModelId === model.modelId ? (
                    <span className="badge">默认</span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-small btn-ghost"
                      disabled={!enabledIds.includes(model.modelId)}
                      onClick={() => setDefaultModel(connection.id, model.modelId)}
                    >
                      设为默认
                    </button>
                  )}
                </div>
              ))}
            </div>

            <div className="form-row model-add">
              <input
                value={newModel}
                onChange={(event) => setNewModel(event.target.value)}
                placeholder="手填模型 ID"
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  addModel(connection.id, newModel)
                  setNewModel('')
                }}
              />
              <button
                type="button"
                className="btn"
                disabled={!newModel.trim()}
                onClick={() => {
                  addModel(connection.id, newModel)
                  setNewModel('')
                }}
              >
                添加模型
              </button>
            </div>

            {isCustom ? (
              <button type="button" className="btn btn-ghost" onClick={() => removeConnection(connection.id)}>
                移除这个服务
              </button>
            ) : null}
          </div>
        </div>

        <footer className="modal-foot">
          <button type="button" className="btn" onClick={closeSettings}>
            完成
          </button>
        </footer>
      </div>
    </div>
  )
}
