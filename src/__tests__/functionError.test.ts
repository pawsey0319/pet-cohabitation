import { userFacingFunctionError } from "../lib/functionError";

function functionFailure(code: string) {
  const response = { json: jest.fn().mockResolvedValue({ error: code }) };
  return {
    message: "Edge Function returned a non-2xx status code",
    context: { clone: () => response },
  };
}

describe("userFacingFunctionError", () => {
  it("explains an offline image route instead of exposing the Supabase wrapper", async () => {
    await expect(userFacingFunctionError(functionFailure("image_model_network_error"))).resolves.toEqual(
      new Error("图片模型通道暂时离线，请确认电脑、CPA 和模型隧道正在运行后重试。"),
    );
  });

  it("maps a synchronous text-model failure during pet seed composition", async () => {
    const result = await userFacingFunctionError(functionFailure("text_model_timeout"));
    expect(result.message).toBe("文本模型响应超时，请稍后重试。");
  });

  it("does not expose an unknown function error payload", async () => {
    const result = await userFacingFunctionError(functionFailure("private_internal_detail"), "异宠生成请求失败，请稍后重试。");
    expect(result.message).toBe("异宠生成请求失败，请稍后重试。");
  });
});
