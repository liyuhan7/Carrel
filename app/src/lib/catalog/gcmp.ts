import type { InputModality, ModelCapability, Protocol, ProviderPreset } from '../../types'

/**
 * Vendor endpoints and model lists taken from GCMP (https://github.com/VicBilibily/GCMP,
 * MIT) provider configs — the vendors the Cherry registry does not ship yet. Auth is
 * layered on in ../catalog.ts; this module is data only. Re-copy from GCMP's
 * src/providers/config/*.json when those vendors change their model line-up.
 */

function preset (value: {
  id: string
  name: string
  protocol: Protocol
  baseUrl: string
  models: Array<{
    id: string
    name: string
    apiModelId?: string
    contextWindow?: number
    input?: InputModality[]
    capabilities?: ModelCapability[]
  }>
}): ProviderPreset {
  return { auth: ['api-key'], modelList: 'api', ...value }
}

export const GCMP_PRESETS: ProviderPreset[] = [
  preset({
    id: "tencent-token",
    name: "腾讯混元 Token Plan",
    protocol: "anthropic-messages",
    baseUrl: "https://api.lkeap.cloud.tencent.com/plan/anthropic",
    models: [
      { id: "hy3-token-plan", name: "Hy3 (TokenPlan)", apiModelId: "hy3", contextWindow: 192000, capabilities: ["tools", "reasoning"] },
      { id: "hy4-preview-token-plan", name: "Hy4 Preview (TokenPlan)", apiModelId: "hy4-preview", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "deepseek-v4-flash-202605-token-plan", name: "DeepSeek-V4-Flash (TokenPlan)", apiModelId: "deepseek-v4-flash-202605", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "deepseek-v4-pro-202606-token-plan", name: "DeepSeek-V4-Pro (TokenPlan)", apiModelId: "deepseek-v4-pro-202606", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "glm-5-token-plan", name: "GLM-5 (TokenPlan)", apiModelId: "glm-5", contextWindow: 168000, capabilities: ["tools", "reasoning"] },
      { id: "minimax-m2.7-token-plan", name: "MiniMax-M2.7 (TokenPlan)", apiModelId: "minimax-m2.7", contextWindow: 168000, capabilities: ["tools"] },
      { id: "glm-5.1-token-plan", name: "GLM-5.1 (TokenPlan)", apiModelId: "glm-5.1", contextWindow: 168000, capabilities: ["tools", "reasoning"] },
      { id: "glm-5.2-token-plan", name: "GLM-5.2 (TokenPlan)", apiModelId: "glm-5.2", contextWindow: 1000000, capabilities: ["tools", "reasoning"] }
    ]
  }),
  preset({
    id: "tencent-tokenhub",
    name: "腾讯 TokenHub",
    protocol: "anthropic-messages",
    baseUrl: "https://tokenhub.tencentmaas.com",
    models: [
      { id: "hy4-preview-tokenhub", name: "Hy4 Preview (TokenHub)", apiModelId: "hy4-preview", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "hy3-tokenhub", name: "Hy3 (TokenHub)", apiModelId: "hy3", contextWindow: 192000, capabilities: ["tools", "reasoning"] },
      { id: "glm-5.3-tokenhub", name: "GLM-5.3 (TokenHub)", apiModelId: "glm-5.3", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "glm-5v-turbo-tokenhub", name: "GLM-5V-Turbo (TokenHub)", apiModelId: "glm-5v-turbo", contextWindow: 168000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "glm-5-turbo-tokenhub", name: "GLM-5-Turbo (TokenHub)", apiModelId: "glm-5-turbo", contextWindow: 168000, capabilities: ["tools"] },
      { id: "deepseek-v4-flash-tokenhub", name: "DeepSeek-V4-Flash (TokenHub)", apiModelId: "deepseek-v4-flash", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "deepseek-v4-pro-tokenhub", name: "DeepSeek-V4-Pro (TokenHub)", apiModelId: "deepseek-v4-pro", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "kimi-k3-tokenhub", name: "Kimi-K3 (TokenHub)", apiModelId: "kimi-k3", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "kimi-k2.7-code-tokenhub", name: "Kimi-K2.7-Code (TokenHub)", apiModelId: "kimi-k2.7-code", contextWindow: 224000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "kimi-k2.7-code-highspeed-tokenhub", name: "Kimi-K2.7-Code HighSpeed (TokenHub)", apiModelId: "kimi-k2.7-code-highspeed", contextWindow: 224000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "kimi-k2.6-tokenhub", name: "Kimi-K2.6 (TokenHub)", apiModelId: "kimi-k2.6", contextWindow: 224000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "minimax-m3-tokenhub", name: "MiniMax-M3 (TokenHub)", apiModelId: "minimax-m3", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "minimax-m2.7-tokenhub", name: "MiniMax-M2.7 (TokenHub)", apiModelId: "minimax-m2.7", contextWindow: 168000, capabilities: ["tools"] }
    ]
  }),
  preset({
    id: "tencent-token-enterprise",
    name: "腾讯 TokenHub 企业版",
    protocol: "anthropic-messages",
    baseUrl: "https://tokenhub.tencentmaas.com/plan/anthropic",
    models: [
      { id: "glm-5.3-token-enterprise", name: "GLM-5.3 (Token Plan Enterprise)", apiModelId: "glm-5.3", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "glm-5.2-token-enterprise", name: "GLM-5.2 (Token Plan Enterprise)", apiModelId: "glm-5.2", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "glm-5-token-enterprise", name: "GLM-5 (Token Plan Enterprise)", apiModelId: "glm-5", contextWindow: 168000, capabilities: ["tools", "reasoning"] },
      { id: "glm-5.1-token-enterprise", name: "GLM-5.1 (Token Plan Enterprise)", apiModelId: "glm-5.1", contextWindow: 168000, capabilities: ["tools", "reasoning"] },
      { id: "glm-5-turbo-token-enterprise", name: "GLM-5-Turbo (Token Plan Enterprise)", apiModelId: "glm-5-turbo", contextWindow: 168000, capabilities: ["tools"] },
      { id: "kimi-k2.7-code-token-enterprise", name: "Kimi-K2.7-Code (Token Plan Enterprise)", apiModelId: "kimi-k2.7-code", contextWindow: 224000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "kimi-k2.7-code-highspeed-token-enterprise", name: "Kimi-K2.7-Code HighSpeed (Token Plan Enterprise)", apiModelId: "kimi-k2.7-code-highspeed", contextWindow: 224000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "kimi-k2.6-token-enterprise", name: "Kimi-K2.6 (Token Plan Enterprise)", apiModelId: "kimi-k2.6", contextWindow: 224000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "minimax-m2.7-token-enterprise", name: "MiniMax-M2.7 (Token Plan Enterprise)", apiModelId: "minimax-m2.7", contextWindow: 168000, capabilities: ["tools"] },
      { id: "minimax-m3-token-enterprise", name: "MiniMax-M3 (Token Plan Enterprise)", apiModelId: "minimax-m3", contextWindow: 512000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "deepseek-v4-flash-token-enterprise", name: "DeepSeek-V4-Flash (Token Plan Enterprise)", apiModelId: "deepseek-v4-flash", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "deepseek-v4-pro-token-enterprise", name: "DeepSeek-V4-Pro (Token Plan Enterprise)", apiModelId: "deepseek-v4-pro", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "deepseek-v4-flash-202605-token-enterprise", name: "DeepSeek-V4-Flash-202605 (Token Plan Enterprise)", apiModelId: "deepseek-v4-flash-202605", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "deepseek-v4-pro-202606-token-enterprise", name: "DeepSeek-V4-Pro-202606 (Token Plan Enterprise)", apiModelId: "deepseek-v4-pro-202606", contextWindow: 1000000, capabilities: ["tools", "reasoning"] }
    ]
  }),
  preset({
    id: "xfyun-coding",
    name: "讯飞星火 Coding Plan",
    protocol: "openai-chat",
    baseUrl: "https://maas-coding-api.cn-huabei-1.xf-yun.com/v2",
    models: [
      { id: "code-xsparkx2agent", name: "Spark X2 Agent (CodingPlan)", apiModelId: "xsparkx2agent", contextWindow: 224000, capabilities: ["tools"] },
      { id: "code-xsparkx2", name: "Spark X2 (CodingPlan)", apiModelId: "xsparkx2", contextWindow: 112000, capabilities: ["tools", "reasoning"] },
      { id: "code-xsparkx2flash", name: "Spark-X2-Flash (CodingPlan)", apiModelId: "xsparkx2flash", contextWindow: 224000, capabilities: ["tools", "reasoning"] },
      { id: "code-xopdeepseekv4pro", name: "DeepSeek-V4-Pro (CodingPlan)", apiModelId: "xopdeepseekv4pro", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "code-xopdeepseekv4flash", name: "DeepSeek-V4-Flash (CodingPlan)", apiModelId: "xopdeepseekv4flash", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "code-xopdeepseekv32", name: "DeepSeek-V3.2 (CodingPlan)", apiModelId: "xopdeepseekv32", contextWindow: 112000, capabilities: ["tools", "reasoning"] },
      { id: "code-xopglm52", name: "GLM-5.2 (CodingPlan)", apiModelId: "xopglm52", contextWindow: 500000, capabilities: ["tools", "reasoning"] },
      { id: "code-xopglm51", name: "GLM-5.1 (CodingPlan)", apiModelId: "xopglm51", contextWindow: 168000, capabilities: ["tools", "reasoning"] },
      { id: "code-xopglm5", name: "GLM-5 (CodingPlan)", apiModelId: "xopglm5", contextWindow: 168000, capabilities: ["tools", "reasoning"] },
      { id: "code-xopglmv47flash", name: "GLM-4.7-Flash (CodingPlan)", apiModelId: "xopglmv47flash", contextWindow: 112000, capabilities: ["tools", "reasoning"] },
      { id: "code-xopkimik26", name: "Kimi-K2.6 (CodingPlan)", apiModelId: "xopkimik26", contextWindow: 224000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "code-xopkimik25", name: "Kimi-K2.5 (CodingPlan)", apiModelId: "xopkimik25", contextWindow: 224000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "code-xminimaxm25", name: "MiniMax-M2.5 (CodingPlan)", apiModelId: "xminimaxm25", contextWindow: 112000, capabilities: ["tools"] },
      { id: "code-xopqwen36v35b", name: "Qwen3.6-35B-A3B (CodingPlan)", apiModelId: "xopqwen36v35b", contextWindow: 112000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "code-xopqwen35v35b", name: "Qwen3.5-35B-A3B (CodingPlan)", apiModelId: "xopqwen35v35b", contextWindow: 112000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "code-xopqwen35397b", name: "Qwen3.5-397B-A17B (CodingPlan)", apiModelId: "xopqwen35397b", contextWindow: 224000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "code-xop3qwencodernext", name: "Qwen3-Coder-Next-FP8 (CodingPlan)", apiModelId: "xop3qwencodernext", contextWindow: 224000, capabilities: ["tools"] }
    ]
  }),
  preset({
    id: "xfyun-token",
    name: "讯飞星火 Token Plan",
    protocol: "openai-chat",
    baseUrl: "https://maas-token-api.cn-huabei-1.xf-yun.com/v2",
    models: [
      { id: "token-spark-x2.5", name: "Spark-X2.5 (TokenPlan)", apiModelId: "spark-x2.5", contextWindow: 224000, capabilities: ["tools", "reasoning"] },
      { id: "token-xsparkx2flash", name: "Spark-X2-Flash (TokenPlan)", apiModelId: "xsparkx2flash", contextWindow: 224000, capabilities: ["tools", "reasoning"] },
      { id: "token-xopdeepseekv4pro", name: "DeepSeek-V4-Pro (TokenPlan)", apiModelId: "xopdeepseekv4pro", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "token-xopdeepseekv4flash", name: "DeepSeek-V4-Flash (TokenPlan)", apiModelId: "xopdeepseekv4flash", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "token-xopdeepseekv32", name: "DeepSeek-V3.2 (TokenPlan)", apiModelId: "xopdeepseekv32", contextWindow: 112000, capabilities: ["tools", "reasoning"] },
      { id: "token-xopglm52", name: "GLM-5.2 (TokenPlan)", apiModelId: "xopglm52", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "token-xopglm51", name: "GLM-5.1 (TokenPlan)", apiModelId: "xopglm51", contextWindow: 168000, capabilities: ["tools", "reasoning"] },
      { id: "token-xopglm5", name: "GLM-5 (TokenPlan)", apiModelId: "xopglm5", contextWindow: 168000, capabilities: ["tools", "reasoning"] },
      { id: "token-xopglmv47flash", name: "GLM-4.7-Flash (TokenPlan)", apiModelId: "xopglmv47flash", contextWindow: 112000, capabilities: ["tools", "reasoning"] },
      { id: "token-xopkimik26", name: "Kimi-K2.6 (TokenPlan)", apiModelId: "xopkimik26", contextWindow: 224000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "token-xopkimik25", name: "Kimi-K2.5 (TokenPlan)", apiModelId: "xopkimik25", contextWindow: 224000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "token-xminimaxm25", name: "MiniMax-M2.5 (TokenPlan)", apiModelId: "xminimaxm25", contextWindow: 112000, capabilities: ["tools"] },
      { id: "token-xopqwen36v35b", name: "Qwen3.6-35B-A3B (TokenPlan)", apiModelId: "xopqwen36v35b", contextWindow: 112000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "token-xopqwen35v35b", name: "Qwen3.5-35B-A3B (TokenPlan)", apiModelId: "xopqwen35v35b", contextWindow: 112000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "token-xopqwen35397b", name: "Qwen3.5-397B-A17B (TokenPlan)", apiModelId: "xopqwen35397b", contextWindow: 224000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "token-xop3qwencodernext", name: "Qwen3-Coder-Next-FP8 (TokenPlan)", apiModelId: "xop3qwencodernext", contextWindow: 224000, capabilities: ["tools"] }
    ]
  }),
  preset({
    id: "antling",
    name: "蚂蚁百灵 AntLing",
    protocol: "anthropic-messages",
    baseUrl: "https://api.ant-ling.com/anthropic",
    models: [
      { id: "Ling-3.0-flash", name: "Ling-3.0-flash", contextWindow: 224000, capabilities: ["tools", "reasoning"] },
      { id: "Ling-3.0-flash-VL", name: "Ling-3.0-flash-VL", contextWindow: 224000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "Ling-3.0-tiny", name: "Ling-3.0-tiny", contextWindow: 224000, capabilities: ["tools", "reasoning"] },
      { id: "Ling-2.6-1T", name: "Ling-2.6-1T", contextWindow: 224000, capabilities: ["tools", "reasoning"] },
      { id: "Ling-2.6-flash", name: "Ling-2.6-flash", contextWindow: 224000, capabilities: ["tools", "reasoning"] },
      { id: "Ring-2.6-1T", name: "Ring-2.6-1T", contextWindow: 224000, capabilities: ["tools", "reasoning"] }
    ]
  }),
  preset({
    id: "clinepass",
    name: "ClinePass",
    protocol: "openai-chat",
    baseUrl: "https://api.cline.bot/api/v1",
    models: [
      { id: "cline-pass/glm-5.3", name: "GLM-5.3 (ClinePass)", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "cline-pass/glm-5.3-flash", name: "GLM-5.3-Flash (ClinePass)", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "cline-pass/kimi-k3.1-pro", name: "Kimi-K3.1-Pro (ClinePass)", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "cline-pass/kimi-k3", name: "Kimi-K3 (ClinePass)", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "cline-pass/deepseek-v4-pro", name: "DeepSeek-V4-Pro (ClinePass)", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "cline-pass/deepseek-v4.1-flash-1017", name: "DeepSeek-V4.1-Flash-1017 (ClinePass)", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "cline-pass/deepseek-v4.1-flash", name: "DeepSeek-V4.1-Flash (ClinePass)", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "cline-pass/mimo-v2.6-pro", name: "MiMo-V2.6-Pro (ClinePass)", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "cline-pass/mimo-v2.6-flash", name: "MiMo-V2.6-Flash (ClinePass)", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "cline-pass/minimax-m3.1-flash", name: "MiniMax-M3.1-Flash (ClinePass)", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "cline-pass/minimax-m3", name: "MiniMax-M3 (ClinePass)", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "cline-pass/muse-spark-1.3-contributor", name: "Muse-Spark-1.3-Contributor (ClinePass)", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "cline-pass/qwen3.8-max", name: "Qwen3.8-Max (ClinePass)", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "cline-pass/qwen3.7-max", name: "Qwen3.7-Max (ClinePass)", contextWindow: 1000000, capabilities: ["tools"] },
      { id: "cline-pass/qwen3.7-plus", name: "Qwen3.7-Plus (ClinePass)", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools"] }
    ]
  }),
  preset({
    id: "commandcode",
    name: "CommandCode",
    protocol: "openai-chat",
    baseUrl: "https://api.commandcode.ai/provider/v1",
    models: [
      { id: "deepseek-v4.1-flash-fast", name: "DeepSeek-V4.1-Flash-Fast (CmdC)", apiModelId: "deepseek/deepseek-v4.1-flash-fast", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash (CmdC)", apiModelId: "deepseek/deepseek-v4.1-flash", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "deepseek-v4-flash", name: "DeepSeek V4 Flash (CmdC)", apiModelId: "deepseek/deepseek-v4-flash", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "deepseek-v4-flash-fast", name: "DeepSeek V4 Flash Fast (CmdC)", apiModelId: "deepseek/deepseek-v4-flash-fast", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "deepseek-v4-flash-vision-exp", name: "DeepSeek V4 Flash Vision (CmdC)", apiModelId: "deepseek/deepseek-v4-flash-vision-exp", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro (CmdC)", apiModelId: "deepseek/deepseek-v4-pro", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash (CmdC)", apiModelId: "google/gemini-3.7-flash", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash (CmdC)", apiModelId: "google/gemini-3.8-flash", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "glm-5", name: "GLM-5 (CmdC)", apiModelId: "zai-org/GLM-5", contextWindow: 168000, capabilities: ["tools"] },
      { id: "glm-5.1", name: "GLM-5.1 (CmdC)", apiModelId: "zai-org/GLM-5.1", contextWindow: 168000, capabilities: ["tools"] },
      { id: "glm-5.2", name: "GLM-5.2 (CmdC)", apiModelId: "zai-org/GLM-5.2", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "glm-5.2-fast", name: "GLM-5.2 Fast (CmdC)", apiModelId: "zai-org/GLM-5.2-Fast", contextWindow: 1000000, capabilities: ["tools"] },
      { id: "glm-5.3", name: "GLM-5.3 (CmdC)", apiModelId: "zai-org/GLM-5.3", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "glm-5.3-flash", name: "GLM-5.3 Flash (CmdC)", apiModelId: "z-ai/glm-5.3-flash", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "glm-5.3-flashx", name: "GLM-5.3-FlashX (CmdC)", apiModelId: "z-ai/glm-5.3-flashx", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "gpt-5.6-luna", name: "GPT-5.6 Luna (CmdC)", contextWindow: 400000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "gpt-5.6-sol", name: "GPT-5.6 Sol (CmdC)", contextWindow: 400000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "gpt-6-luna", name: "GPT-6 Luna (CmdC)", contextWindow: 400000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "grok-4.5", name: "Grok 4.5 (CmdC)", apiModelId: "xai/grok-4.5", contextWindow: 500000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "grok-4.6", name: "Grok 4.6 (CmdC)", apiModelId: "xai/grok-4.6", contextWindow: 500000, capabilities: ["tools", "reasoning"] },
      { id: "grok-4.7", name: "Grok 4.7 (CmdC)", apiModelId: "xai/grok-4.7", contextWindow: 500000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "inkling", name: "Inkling (CmdC)", apiModelId: "thinkingmachines/inkling", contextWindow: 224000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "inkling-small", name: "Inkling Small (CmdC)", apiModelId: "thinkingmachines/inkling-small", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "kimi-k2.5", name: "Kimi K2.5 (CmdC)", apiModelId: "moonshotai/Kimi-K2.5", contextWindow: 224000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "kimi-k2.6", name: "Kimi K2.6 (CmdC)", apiModelId: "moonshotai/Kimi-K2.6", contextWindow: 224000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "kimi-k2.7-code", name: "Kimi K2.7 Code (CmdC)", apiModelId: "moonshotai/Kimi-K2.7-Code", contextWindow: 224000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "kimi-k2.7-code-highspeed", name: "Kimi K2.7 Code HighSpeed (CmdC)", apiModelId: "moonshotai/Kimi-K2.7-Code-Highspeed", contextWindow: 224000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "kimi-k3.1-pro", name: "Kimi-K3.1-Pro (CmdC)", apiModelId: "moonshotai/Kimi-K3.1-Pro", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "kimi-k3", name: "Kimi K3 (CmdC)", apiModelId: "moonshotai/Kimi-K3", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "mimo-v2.6-flash", name: "MiMo-V2.6-Flash (CmdC)", apiModelId: "xiaomi/mimo-v2.6-flash", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "mimo-v2.6-pro", name: "MiMo-V2.6-Pro (CmdC)", apiModelId: "xiaomi/mimo-v2.6-pro", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "mimo-v2.6-pro-ultraspeed", name: "MiMo-V2.6-Pro-UltraSpeed (CmdC)", apiModelId: "xiaomi/mimo-v2.6-pro-ultraspeed", contextWindow: 1000000, capabilities: ["tools"] },
      { id: "minimax-m3.1-flash", name: "MiniMax-M3.1-Flash (CmdC)", apiModelId: "minimax/minimax-m3.1-flash", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "minimax-m3", name: "MiniMax M3 (CmdC)", apiModelId: "MiniMaxAI/MiniMax-M3", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "muse-spark-1.2", name: "Muse Spark 1.2 (CmdC)", apiModelId: "meta/muse-spark-1.2", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "muse-spark-1.2-contributor", name: "Muse Spark 1.2 Contributor (CmdC)", apiModelId: "meta/muse-spark-1.2-contributor", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "muse-spark-1.3", name: "Muse Spark 1.3 (CmdC)", apiModelId: "meta/muse-spark-1.3", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor (CmdC)", apiModelId: "meta/muse-spark-1.3-contributor", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "muse-spark-open", name: "Muse-Spark-Open (CmdC)", apiModelId: "meta/muse-spark-open", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "muse-wonder-1.0", name: "Muse-Wonder-1.0 (CmdC)", apiModelId: "meta/muse-wonder-1.0", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "nemotron-3-ultra", name: "Nemotron 3 Ultra (CmdC)", apiModelId: "nvidia/nemotron-3-ultra-550b-a55b", contextWindow: 1000000, capabilities: ["tools"] },
      { id: "nemotron-3.5-super-vl", name: "Nemotron-3.5-Super-VL (CmdC)", apiModelId: "nvidia/nemotron-3.5-super-vl", contextWindow: 224000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "qwen-3.8-27b", name: "Qwen 3.8 27B (CmdC)", apiModelId: "Qwen/Qwen3.8-27B", contextWindow: 224000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "qwen-3.8-flash", name: "Qwen 3.8 Flash (CmdC)", apiModelId: "Qwen/Qwen3.8-Flash", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "qwen-3.8-max", name: "Qwen 3.8 Max (CmdC)", apiModelId: "Qwen/Qwen3.8-Max", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "qwen-3.8-max-0902", name: "Qwen 3.8 Max 0902 (CmdC)", apiModelId: "Qwen/Qwen3.8-Max-0902", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "qwen-3.8-max-prime", name: "Qwen3.8-Max-Prime (CmdC)", apiModelId: "Qwen/Qwen3.8-Max-Prime", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "step-3.5-flash", name: "Step 3.5 Flash (CmdC)", apiModelId: "stepfun/Step-3.5-Flash", contextWindow: 192000, capabilities: ["tools"] },
      { id: "step-3.7-flash", name: "Step 3.7 Flash (CmdC)", apiModelId: "stepfun/Step-3.7-Flash", contextWindow: 224000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "tencent-hy3", name: "Tencent Hy3 (CmdC)", apiModelId: "tencent/hy3-paid", contextWindow: 224000, capabilities: ["tools"] },
      { id: "tencent-hy4-preview", name: "Tencent Hy4 Preview (CmdC)", apiModelId: "tencent/hy4-preview", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "longcat-2.0", name: "LongCat-2.0 (CmdC)", apiModelId: "meituan/LongCat-2.0", contextWindow: 1000000, capabilities: ["tools"] },
      { id: "step-5-preview", name: "Step-5-Preview (CmdC)", apiModelId: "stepfun/Step-5-Preview", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "mistral-large-4", name: "Mistral-Large-4 (CmdC)", apiModelId: "mistral/mistral-large-4", contextWindow: 512000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "ornith-1.5-122b", name: "Ornith-1.5-122B (CmdC)", apiModelId: "ornith/ornith-1.5-122b", contextWindow: 224000, input: ['text', 'image'], capabilities: ["tools"] }
    ]
  }),
  preset({
    id: "hyper",
    name: "Charm Hyper",
    protocol: "openai-chat",
    baseUrl: "https://hyper.charm.land/v1",
    models: [
      { id: "deepseek-v4.1-flash-1017", name: "DeepSeek-V4.1-Flash-1017 (Hyper)", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "deepseek-v4.1-flash", name: "DeepSeek-V4.1-Flash (Hyper)", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "deepseek-v4-flash-0731", name: "DeepSeek-V4-Flash-0731 (Hyper)", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "deepseek-v4-pro-0813", name: "DeepSeek-V4-Pro-0813 (Hyper)", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "gemma-4-26b-a4b-it", name: "Gemma-4-26B-A4B (Hyper)", contextWindow: 236000, capabilities: ["tools"] },
      { id: "glm-5.2", name: "GLM-5.2 (Hyper)", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "glm-5.3", name: "GLM-5.3 (Hyper)", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "glm-5.3-flash", name: "GLM-5.3-Flash (Hyper)", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "gpt-oss-120b", name: "GPT-OSS-120B (Hyper)", contextWindow: 118000, capabilities: ["tools", "reasoning"] },
      { id: "inkling", name: "Inkling (Hyper)", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "kimi-k2.7-code", name: "Kimi-K2.7-Code (Hyper)", contextWindow: 224000, input: ['text', 'image'], capabilities: ["tools"] },
      { id: "kimi-k2-thinking", name: "Kimi-K2-Thinking (Hyper)", contextWindow: 236000, capabilities: ["tools"] },
      { id: "kimi-k3", name: "Kimi-K3 (Hyper)", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "minimax-m2.7", name: "MiniMax-M2.7 (Hyper)", contextWindow: 168000, capabilities: ["tools"] },
      { id: "minimax-m3", name: "MiniMax-M3 (Hyper)", contextWindow: 512000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "qwen3.7-flash", name: "Qwen3.7-Flash (Hyper)", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "qwen3.7-max", name: "Qwen3.7-Max (Hyper)", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "qwen3.7-plus", name: "Qwen3.7-Plus (Hyper)", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "qwen3.8-2.4t-a95b", name: "Qwen3.8-2.4T-A95B (Hyper)", contextWindow: 1000000, capabilities: ["tools", "reasoning"] },
      { id: "qwen3.8-27b", name: "Qwen3.8-27B (Hyper)", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "qwen3.8-flash", name: "Qwen3.8-Flash (Hyper)", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] },
      { id: "qwen3.8-max", name: "Qwen3.8-Max (Hyper)", contextWindow: 1000000, input: ['text', 'image'], capabilities: ["tools", "reasoning"] }
    ]
  })
]
