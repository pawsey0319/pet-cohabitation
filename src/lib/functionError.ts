const FRIENDLY_FUNCTION_ERRORS: Readonly<Record<string, string>> = {
  unauthenticated: "登录状态已过期，请重新登录后再试。",
  text_model_network_error: "文本模型通道暂时离线，请确认电脑、CPA 和模型隧道正在运行后重试。",
  text_model_timeout: "文本模型响应超时，请稍后重试。",
  text_model_rate_limited: "文本模型当前请求较多，请稍后重试。",
  text_model_content_blocked: "这份描述未通过内容安全检查，请调整后重试。",
  image_model_network_error: "图片模型通道暂时离线，请确认电脑、CPA 和模型隧道正在运行后重试。",
  image_model_timeout: "图片生成超时，这次任务可以稍后重试。",
  image_model_rate_limited: "图片模型当前请求较多，请稍后重试。",
  image_model_content_blocked: "这份外观描述未通过图片安全检查，请调整后重试。",
  image_generation_paused: "管理员暂时暂停了图片生成。",
  structured_pet_onboarding_disabled: "新版异宠创建功能暂未开放。",
  structured_pet_expectations_required: "请先完整填写异宠的外观、性格和相处方式。",
  initial_editing_permanently_closed: "这只异宠已经确认，不能重新修改初始设定。",
  generation_retry_limit_reached: "这次生成已达到重试上限，请重新发起一次生成。",
  model_quota_exceeded: "今天的模型使用额度已用完，请明天再试。",
};

function mappedMessage(code: string): string | null {
  if (FRIENDLY_FUNCTION_ERRORS[code]) return FRIENDLY_FUNCTION_ERRORS[code];
  if (/^text_model_http_\d+$/.test(code)) return "文本模型服务暂时异常，请稍后重试。";
  if (/^image_model_http_\d+$/.test(code)) return "图片模型服务暂时异常，请稍后重试。";
  if (/quota|daily_limit|global_image_limit/i.test(code)) return "今天的图片生成额度已用完，请明天再试。";
  return null;
}

async function responseErrorCode(reason: unknown): Promise<string | null> {
  if (!reason || typeof reason !== "object" || !("context" in reason)) return null;
  const context = (reason as { context?: unknown }).context;
  if (!context || typeof context !== "object") return null;
  try {
    const readable = "clone" in context && typeof context.clone === "function"
      ? context.clone()
      : context;
    if (!("json" in readable) || typeof readable.json !== "function") return null;
    const payload = await readable.json() as { error?: unknown };
    return typeof payload?.error === "string" ? payload.error : null;
  } catch {
    return null;
  }
}

export async function userFacingFunctionError(
  reason: unknown,
  fallback = "云端请求失败，请稍后重试。",
): Promise<Error> {
  const responseCode = await responseErrorCode(reason);
  if (responseCode) return new Error(mappedMessage(responseCode) ?? fallback);
  if (reason instanceof Error && !/Edge Function returned a non-2xx status code/i.test(reason.message)) {
    return new Error(mappedMessage(reason.message) ?? reason.message);
  }
  return new Error(fallback);
}
