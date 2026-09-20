// Uses only synthetic inputs. Set TEXT_* and MODEL_MOCK_MODE=false in this process.
import { TextModelAdapter } from "../supabase/functions/_shared/modelAdapters.ts";
const adapter = new TextModelAdapter();
await adapter.checkStructuredOutput();
console.log("PASS: actual structured-output health request");
const reply = await adapter.generatePetReply({
  petName: "测试芽芽", personality: "安静敏锐，先倾听", styleSignals: "",
  messages: [], currentMessage: "今天有点累，先陪我说说话。",
  ownerPolicy: "pet_only", contextPolicy: "owner_private_cross_space",
});
if (!reply.content) throw new Error("reply_missing");
console.log("PASS: actual private reply schema");
const seed = await adapter.composePetSeed({
  name: "测试芽芽", appearance: "透明鳍、不对称触角的小型软体生物",
  personality: "安静敏锐，有自己的判断", companionship: "先倾听，需要时给简短建议",
  excludedFeatures: "人脸、猫狗轮廓", additionalDescription: "原创像素全身异宠",
});
if (!seed.visual_seed_prompt || !seed.personality_seed_prompt) throw new Error("seed_missing");
console.log("PASS: actual pet seed compilation schema");
