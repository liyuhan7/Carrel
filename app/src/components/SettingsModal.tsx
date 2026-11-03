import { useEffect, useState } from 'react'
import { useStore } from '../store'

export function SettingsModal () {
  const providers = useStore((s) => s.providers)
  const activeProviderId = useStore((s) => s.activeProviderId)
  const closeSettings = useStore((s) => s.closeSettings)
  const updateProvider = useStore((s) => s.updateProvider)
  const saveKey = useStore((s) => s.saveKey)
  const clearKey = useStore((s) => s.clearKey)
  const setActiveProvider = useStore((s) => s.setActiveProvider)
  const notify = useStore((s) => s.notify)

  const requested = useStore((s) => s.settingsProvider)
  const [selected, setSelected] = useState(requested ?? activeProviderId)
  const [key, setKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const provider = providers.find((item) => item.id === selected) ?? providers[0]

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
  }, [selected])

  const test = async () => {
    setTesting(true)
    setResult(null)
    try {
      const response = await window.cs.testProvider({ provider, apiKey: key.trim() || undefined })
      setResult(response)
    } catch (err) {
      setResult({ ok: false, message: (err as Error).message })
    } finally {
      setTesting(false)
    }
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
            {providers.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`provider-item${item.id === provider.id ? ' is-active' : ''}`}
                onClick={() => setSelected(item.id)}
              >
                <span className="provider-name">{item.name}</span>
                {item.id === activeProviderId ? <span className="badge">默认</span> : null}
                {item.kind !== 'demo' && !item.hasKey ? <span className="dot" title="未配置密钥" /> : null}
              </button>
            ))}
          </aside>

          <div className="provider-form">
            {provider.kind === 'demo' ? (
              <>
                <h3>演示模式</h3>
                <p className="hint">
                  回答由本地模板生成，不会把资料发送到任何服务，用来先走一遍阅读、提问、引用、笔记的完整流程。
                </p>
                <button type="button" className="btn btn-primary" onClick={() => setActiveProvider(provider.id)}>
                  {activeProviderId === provider.id ? '正在使用' : '设为默认'}
                </button>
              </>
            ) : (
              <>
                <h3>{provider.name}</h3>
                <label className="field">
                  <span>接口地址</span>
                  <input
                    value={provider.baseUrl}
                    onChange={(event) => updateProvider(provider.id, { baseUrl: event.target.value })}
                    placeholder="https://api.example.com/v1"
                  />
                </label>
                <label className="field">
                  <span>模型 ID</span>
                  <input
                    value={provider.model}
                    onChange={(event) => updateProvider(provider.id, { model: event.target.value })}
                    placeholder="模型名称"
                  />
                </label>
                <label className="field">
                  <span>API Key</span>
                  <input
                    type="password"
                    value={key}
                    onChange={(event) => setKey(event.target.value)}
                    placeholder={provider.hasKey ? '已保存，输入新值可替换' : '粘贴 API Key'}
                  />
                </label>

                <div className="form-row">
                  <button type="button" className="btn" disabled={testing} onClick={() => void test()}>
                    {testing ? '测试中…' : '测试连接'}
                  </button>
                  <button type="button" className="btn btn-primary" disabled={!key.trim()} onClick={() => void saveKey(provider.id, key.trim()).then(() => { setKey(''); notify('密钥已保存到系统安全存储') })}>
                    保存密钥
                  </button>
                  {provider.hasKey ? (
                    <button type="button" className="btn btn-ghost" onClick={() => void clearKey(provider.id)}>
                      移除密钥
                    </button>
                  ) : null}
                  <span className="tool-spacer" />
                  <button
                    type="button"
                    className="btn"
                    disabled={activeProviderId === provider.id}
                    onClick={() => {
                      setActiveProvider(provider.id)
                      notify(`已切换到 ${provider.name}`)
                    }}
                  >
                    {activeProviderId === provider.id ? '正在使用' : '设为默认'}
                  </button>
                </div>

                {result ? <p className={result.ok ? 'result is-ok' : 'result is-error'}>{result.message}</p> : null}

                <p className="hint">
                  兼容 OpenAI Chat Completions 接口的服务填到「接口地址」，包括 DeepSeek、智谱、Kimi 和自建网关。密钥保存在系统安全存储中，不会写入配置文件。
                </p>
              </>
            )}
          </div>
        </div>

        <footer className="modal-foot">
          <span className="hint">资料只在提问时按所选范围发送</span>
          <button type="button" className="btn" onClick={closeSettings}>
            完成
          </button>
        </footer>
      </div>
    </div>
  )
}
