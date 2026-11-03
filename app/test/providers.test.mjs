import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_ACTIVE_MODEL, PRESETS, activeRoute, adoptSaved, authReady, describeModel,
  enabledModels, mergeDiscovered, modelOptions, routeOf
} from '../src/lib/providers.ts'

const presetWithModels = PRESETS.find((preset) => preset.protocol !== 'demo' && preset.models.length)
const knownModelId = presetWithModels.models[0].id

test('legacy provider list migrates to connections and keeps the active choice', () => {
  const { connections, activeModel } = adoptSaved({
    providers: [
      { id: 'demo', name: '演示模式', kind: 'demo', baseUrl: '', model: '本地演示' },
      { id: 'deepseek', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
      { id: 'anthropic', name: 'Claude', kind: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5' }
    ],
    activeProviderId: 'deepseek'
  })
  assert.ok(connections.length > 3, 'new presets are appended')
  assert.deepEqual(connections[0].enabledModelIds, ['demo'])
  assert.equal(connections[0].authMethod, 'none')
  assert.deepEqual(connections[1].enabledModelIds, ['deepseek-chat'])
  assert.equal(connections[1].authMethod, 'api-key')
  assert.equal(connections[2].protocol, 'anthropic-messages')
  assert.deepEqual(activeModel, { connectionId: 'deepseek', modelId: 'deepseek-chat' })
})

test('a saved active model that no longer resolves falls back to an enabled one', () => {
  const connections = [
    { id: 'deepseek', presetId: 'deepseek', name: 'DeepSeek', protocol: 'openai-chat', baseUrl: '', authMethod: 'api-key', enabledModelIds: ['deepseek-chat'] },
    { id: 'openai', presetId: 'openai', name: 'OpenAI', protocol: 'openai-chat', baseUrl: '', authMethod: 'api-key', enabledModelIds: [] }
  ]
  const { activeModel } = adoptSaved({ connections, activeModel: { connectionId: 'openai', modelId: 'gpt-4o' } })
  assert.deepEqual(activeModel, { connectionId: 'deepseek', modelId: 'deepseek-chat' })
  assert.deepEqual(enabledModels(connections[1]), [])
})

test('catalog models keep their metadata, hand-typed ids do not', () => {
  const connection = {
    id: presetWithModels.id,
    presetId: presetWithModels.id,
    name: presetWithModels.name,
    protocol: presetWithModels.protocol,
    baseUrl: presetWithModels.baseUrl,
    authMethod: 'api-key',
    enabledModelIds: [knownModelId, 'my-gateway-model']
  }
  const known = describeModel(connection, knownModelId)
  assert.equal(known.provenance, 'preset')
  assert.equal(known.displayName, presetWithModels.models[0].name)

  const unknown = describeModel(connection, 'my-gateway-model')
  assert.equal(unknown.provenance, 'user')
  assert.deepEqual(unknown.input, ['text'])

  assert.deepEqual(modelOptions([connection]).map((option) => option.model.modelId), [knownModelId, 'my-gateway-model'])
  assert.deepEqual(routeOf(connection, unknown), {
    connectionId: connection.id,
    modelId: 'my-gateway-model',
    protocol: presetWithModels.protocol,
    baseUrl: presetWithModels.baseUrl,
    authMethod: 'api-key',
    projectId: undefined
  })
})

test('discovered models merge under catalog metadata', () => {
  const connection = {
    id: presetWithModels.id,
    presetId: presetWithModels.id,
    name: presetWithModels.name,
    protocol: presetWithModels.protocol,
    baseUrl: presetWithModels.baseUrl,
    authMethod: 'api-key',
    enabledModelIds: []
  }
  const merged = mergeDiscovered(connection, [
    { id: knownModelId },
    { id: 'brand-new-model', name: 'Brand New' }
  ])
  assert.equal(merged[0].provenance, 'preset')
  assert.equal(merged[1].provenance, 'discovered')
  assert.equal(merged[1].displayName, 'Brand New')
  assert.equal(merged[1].apiModelId, 'brand-new-model')
})

test('auth readiness follows the selected credential method', () => {
  const base = { id: 'x', presetId: 'custom', name: 'X', protocol: 'openai-chat', baseUrl: '', enabledModelIds: [] }
  assert.equal(authReady({ ...base, authMethod: 'api-key', hasKey: true }), true)
  assert.equal(authReady({ ...base, authMethod: 'api-key', hasKey: false }), false)
  assert.equal(authReady({ ...base, authMethod: 'oauth', hasOAuth: true }), true)
  assert.equal(authReady({ ...base, authMethod: 'external-cli', hasSubscription: true }), true)
  assert.equal(authReady({ ...base, authMethod: 'copilot', hasSubscription: false }), false)
})

test('activeRoute prefers the requested model, then the default', () => {
  const connection = {
    id: presetWithModels.id,
    presetId: presetWithModels.id,
    name: presetWithModels.name,
    protocol: presetWithModels.protocol,
    baseUrl: presetWithModels.baseUrl,
    authMethod: 'api-key',
    enabledModelIds: presetWithModels.models.map((model) => model.id),
    defaultModelId: presetWithModels.models[0].id
  }
  const picked = activeRoute([connection], { connectionId: connection.id, modelId: connection.enabledModelIds[1] ?? connection.enabledModelIds[0] })
  assert.equal(picked.model.modelId, connection.enabledModelIds[1] ?? connection.enabledModelIds[0])
})

test('a fresh install starts on the demo preset', () => {
  const { connections, activeModel } = adoptSaved(null)
  assert.equal(connections.length, PRESETS.length)
  assert.deepEqual(activeModel, DEFAULT_ACTIVE_MODEL)
})
