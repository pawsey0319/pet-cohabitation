# 异宠共生关系空间 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 交付一个可在 iOS、Android 和 Web 运行的 Expo/React Native 纵向 MVP，完整演示唯一异宠、跨空间记忆隔离、离线共生、主 Agent、低风险代理和连续进化。

**Architecture:** 单客户端本地优先原型。纯 TypeScript 领域层实现全部信任边界与确定性 Agent 模拟，React Context/reducer 管理可持久化状态，React Native 组件渲染移动端界面。未来云端 Agent、消息与加密实现只能替换 `AgentRuntime`/`Repository` 边界，不得绕过领域策略。

**Tech Stack:** Expo 57.0.15、React 19.2.3、React Native 0.86.2、React Native Web 0.21.2、TypeScript 6.0.3、Jest Expo 57.0.4、React Native Testing Library 14.0.1、AsyncStorage 2.2.0、React Native SVG 15.15.4、Expo Linear Gradient 57.0.1。版本取自 `create-expo-app@4.0.0` 的 Expo 57 官方模板及 `expo install` 兼容解析结果。

**Spec:** `docs/superpowers/specs/2026-08-21-pet-cohabitation-mvp-design.md`

## Global Constraints

- 每个账户终身只有一只异宠；代码不得出现换宠、重抽、死亡、饥饿、经验值或亲密度字段。
- 具体人物、事件与对话只能存在于对应 `SpaceMemoryVault`，任何跨空间读取必须被策略层拒绝。
- 异宠只能自动执行低风险操作；见面、情感承诺、关系变化、位置、消费、财务、健康必须等待本人确认。
- Agent 输出必须带 `actorType` 与权限来源，不能冒充人类消息。
- 原型不得宣称实现了生产端到端加密、后台自治 Agent 或真实模型调用。
- 所有用户界面使用中文，内容保持 16+、全年龄友好。

---

## 文件结构

- `src/domain/types.ts`：唯一领域类型来源。
- `src/domain/policies.ts`：记忆、代理与空间治理策略。
- `src/domain/evolution.ts`：身份锚点不可变的进化算法。
- `src/domain/agentRuntime.ts`：本地确定性主 Agent/异宠模拟。
- `src/domain/seed.ts`：可重复的演示数据。
- `src/state/AppState.tsx`：reducer、动作、AsyncStorage 持久化。
- `src/components/*`：无业务状态的视觉组件。
- `src/screens/*`：总览、空间、异宠三个主界面。
- `src/__tests__/*`：领域边界、reducer 与关键 UI 回归测试。

### Task 1: Expo 脚手架与测试基线

**Files:**
- Create: `package.json`, `app.json`, `babel.config.js`, `tsconfig.json`, `jest.config.js`, `App.tsx`, `.gitignore`
- Create: `src/__tests__/smoke.test.ts`

**Interfaces:**
- Produces: `npm run web`, `npm test`, `npm run typecheck`, `npm run export:web`。

- [ ] **Step 1: Write the failing test**

```ts
// src/__tests__/smoke.test.ts
describe("test harness", () => {
  it("runs TypeScript tests", () => expect(1 + 1).toBe(2));
});
```

- [ ] **Step 2: Run test to verify the harness is absent**

Run: `npm test -- --runInBand`
Expected: FAIL because `package.json` and Jest configuration do not exist.

- [ ] **Step 3: Add the Expo 57 package manifest and configs**

`package.json` must pin the versions in the Tech Stack and provide:

```json
{
  "scripts": {
    "start": "expo start",
    "web": "expo start --web",
    "test": "jest",
    "typecheck": "tsc --noEmit",
    "export:web": "expo export --platform web"
  }
}
```

`App.tsx` initially renders `<Text>异宠共生空间</Text>` inside `SafeAreaView`.

- [ ] **Step 4: Install and verify**

Run: `npm install && npm test -- --runInBand && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "chore: scaffold Expo pet cohabitation MVP"
```

### Task 2: Domain types and hard trust policies

**Files:**
- Create: `src/domain/types.ts`, `src/domain/policies.ts`
- Test: `src/__tests__/policies.test.ts`

**Interfaces:**
- Produces:
  - `type RelationshipKind = "lover_pair" | "friend_pair" | "friend_circle"`
  - `type ActionRisk = "low" | "high"`
  - `getPetContextForSpace(pet, spaceId): PetContext`
  - `classifyDelegatedAction(kind): ActionRisk`
  - `canPetExecute(action): boolean`
  - `canRevealMemory(memory, requesterId): "allow" | "require_owner" | "deny"`

- [ ] **Step 1: Write failing policy tests**

```ts
it("never exposes another space event", () => {
  const context = getPetContextForSpace(pet, "space-old-friends");
  expect(context.memories.map((m) => m.spaceId)).toEqual(["space-old-friends"]);
  expect(JSON.stringify(context)).not.toContain("周六去海边");
});

it.each(["meetup", "relationship_change", "location", "purchase", "finance", "health"])(
  "blocks high-risk %s",
  (kind) => expect(canPetExecute({ kind })).toBe(false),
);
```

- [ ] **Step 2: Run to see missing modules fail**

Run: `npm test -- --runInBand src/__tests__/policies.test.ts`
Expected: FAIL with missing `domain/policies`.

- [ ] **Step 3: Implement the minimal immutable types and policies**

`getPetContextForSpace` may include global abstract traits but must filter concrete memories by exact `spaceId`. Sensitive memories return `require_owner` for non-owner requesters. `canPetExecute` returns true only for `game_invite`, `light_vote`, `tentative_reminder`, `tentative_task`, and `preference_guess`.

- [ ] **Step 4: Verify**

Run: `npm test -- --runInBand src/__tests__/policies.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain src/__tests__/policies.test.ts
git commit -m "feat: enforce pet memory and delegation boundaries"
```

### Task 3: Identity-preserving evolution and narrative growth

**Files:**
- Create: `src/domain/evolution.ts`
- Test: `src/__tests__/evolution.test.ts`

**Interfaces:**
- Produces:
  - `proposeEvolution(pet, experiences, ownerExpectation): EvolutionEvent`
  - `applyEvolution(pet, event): UserPet`
  - `writeGrowthDiary(event): string`

- [ ] **Step 1: Write failing evolution tests**

```ts
it("preserves every identity anchor", () => {
  const event = proposeEvolution(pet, experiences, "希望你更勇敢");
  const next = applyEvolution(pet, event);
  expect(next.identityAnchors).toEqual(pet.identityAnchors);
  expect(event.sources.length).toBeGreaterThan(0);
  expect(event.ownerInfluence).toBe("希望你更勇敢");
  expect(event.decisionBy).toBe("pet");
});
```

- [ ] **Step 2: Run and observe missing implementation**

Run: `npm test -- --runInBand src/__tests__/evolution.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement deterministic incremental evolution**

Map experience categories (`care`, `work`, `social`, `shared`) to additive visual traits. Hash `pet.lifeSeed + source ids` to choose one of the eligible traits. Never mutate anchors; never expose numeric progress. Owner expectation may weight a category but cannot specify the final trait.

- [ ] **Step 4: Verify**

Run: `npm test -- --runInBand src/__tests__/evolution.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/evolution.ts src/__tests__/evolution.test.ts
git commit -m "feat: add identity-preserving pet evolution"
```

### Task 4: Local Agent runtime, absence simulation, and governance

**Files:**
- Create: `src/domain/agentRuntime.ts`, `src/domain/seed.ts`
- Test: `src/__tests__/agentRuntime.test.ts`

**Interfaces:**
- Produces:
  - `summarizeSpace(space, messages): AgentCard`
  - `simulateOwnerAbsence(state, now): SimulationResult`
  - `askPetWhatHappened(pet, spaceId): PetNarrative`
  - `createDelegatedAction(pet, request): DelegatedAction`
  - `applyPetGovernance(space, petId, vote): RelationshipSpace`

- [ ] **Step 1: Write failing runtime tests**

```ts
it("keeps objective summary separate from pet narrative", () => {
  expect(summarizeSpace(space, messages).actorType).toBe("space_agent");
  expect(askPetWhatHappened(pet, space.id).actorType).toBe("pet");
});

it("does not punish a pet for owner absence", () => {
  const result = simulateOwnerAbsence(state, addDays(state.lastActiveAt, 5));
  expect(result.pet.status).toBe("waiting_warmly");
  expect(JSON.stringify(result)).not.toMatch(/死亡|退化|饥饿|责怪/);
});
```

- [ ] **Step 2: Run and observe failure**

Run: `npm test -- --runInBand src/__tests__/agentRuntime.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement deterministic local simulation**

Generate at most one relevant pet message and two pet-corner stories per elapsed day, capped at three days. Human-related commitments remain `pending_owner`; pet-only games and care events may complete automatically. Respect local mute and majority pause before adding any proactive message.

- [ ] **Step 4: Verify**

Run: `npm test -- --runInBand src/__tests__/agentRuntime.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/agentRuntime.ts src/domain/seed.ts src/__tests__/agentRuntime.test.ts
git commit -m "feat: simulate autonomous but bounded pet life"
```

### Task 5: State, persistence, and user actions

**Files:**
- Create: `src/state/AppState.tsx`
- Test: `src/__tests__/appReducer.test.ts`

**Interfaces:**
- Produces: `AppProvider`, `useAppState()`, and reducer actions `SEND_HUMAN_MESSAGE`, `CARE_FOR_PET`, `CONFIRM_ACTION`, `REVOKE_ACTION`, `QUERY_PET`, `RUN_SPACE_SUMMARY`, `PROPOSE_EVOLUTION`, `APPLY_EVOLUTION`, `TOGGLE_LOCAL_MUTE`, `SET_ACTIVE_SPACE`, `RESET_DEMO`.

- [ ] **Step 1: Write failing reducer tests**

```ts
it("cannot confirm a blocked action", () => {
  const next = appReducer(seed, { type: "REQUEST_DELEGATION", request: { kind: "purchase" } });
  expect(next.delegatedActions.at(-1)?.status).toBe("blocked");
});

it("care from another member creates a social experience without changing anchors", () => {
  const next = appReducer(seed, { type: "CARE_FOR_PET", spaceId, byUserId: "friend-1", care: "fruit" });
  expect(next.pet.identityAnchors).toEqual(seed.pet.identityAnchors);
  expect(next.pet.experiences.at(-1)?.category).toBe("social");
});
```

- [ ] **Step 2: Run and observe failure**

Run: `npm test -- --runInBand src/__tests__/appReducer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement reducer and AsyncStorage persistence**

Persist under `pet-cohabitation-mvp-v1`. Hydration runs `simulateOwnerAbsence` once using the saved `lastActiveAt`; `RESET_DEMO` deletes the key and reloads deterministic seed data.

- [ ] **Step 4: Verify**

Run: `npm test -- --runInBand src/__tests__/appReducer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state src/__tests__/appReducer.test.ts
git commit -m "feat: add persistent pet cohabitation state"
```

### Task 6: Visual system, pet avatar, navigation, and dual-core dashboard

**Files:**
- Create: `src/theme/tokens.ts`, `src/components/PetAvatar.tsx`, `src/components/BottomNav.tsx`, `src/components/AgentBadge.tsx`, `src/components/GlassCard.tsx`, `src/screens/HomeScreen.tsx`, `src/AppShell.tsx`
- Modify: `App.tsx`
- Test: `src/__tests__/dashboard.test.tsx`

**Interfaces:**
- Consumes: `useAppState`, `UserPet`, `RelationshipSpace`.
- Produces: tabs `home | space | pet`; dashboard cards for pet, spaces, pending delegations, tonight ritual.

- [ ] **Step 1: Write failing UI smoke test**

```tsx
it("renders the four dual-core dashboard regions", () => {
  render(<App />);
  expect(screen.getByText("今天的异宠")).toBeTruthy();
  expect(screen.getByText("关系空间")).toBeTruthy();
  expect(screen.getByText("待你确认")).toBeTruthy();
  expect(screen.getByText("今晚碰个面")).toBeTruthy();
});
```

- [ ] **Step 2: Run and observe failure**

Run: `npm test -- --runInBand src/__tests__/dashboard.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement the mobile-first dashboard**

Use a deep indigo background, warm coral accent, mint agent color, large rounded cards, and a vector `PetAvatar` built from stable SVG anchors plus additive traits. No XP/progress UI. Pending agent actions use clear “异宠代办” labels.

- [ ] **Step 4: Verify**

Run: `npm test -- --runInBand src/__tests__/dashboard.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add App.tsx src/components src/screens/HomeScreen.tsx src/theme src/AppShell.tsx src/__tests__/dashboard.test.tsx
git commit -m "feat: build dual-core pet and relationship dashboard"
```

### Task 7: Space, pet corner, main Agent, and pet life screens

**Files:**
- Create: `src/screens/SpaceScreen.tsx`, `src/screens/PetScreen.tsx`, `src/components/MessageBubble.tsx`, `src/components/AgentCard.tsx`, `src/components/PetCorner.tsx`, `src/components/DelegationCard.tsx`, `src/components/EvolutionSheet.tsx`
- Modify: `src/AppShell.tsx`
- Test: `src/__tests__/criticalFlows.test.tsx`

**Interfaces:**
- Consumes: all reducer actions and domain policies.
- Produces: send message, summarize, query pet, care, confirm/revoke action, mute/pause pet, propose/apply evolution, view/edit/delete memories.

- [ ] **Step 1: Write failing critical-flow tests**

```tsx
it("labels human, pet and space agent content differently", () => {
  render(<App />);
  fireEvent.press(screen.getByText("老友小圈"));
  expect(screen.getByText("空间主 Agent")).toBeTruthy();
  expect(screen.getByText(/异宠视角/)).toBeTruthy();
});

it("shows owner expectation without offering final-form selection", () => {
  render(<App />);
  fireEvent.press(screen.getByText("异宠"));
  expect(screen.getByPlaceholderText("写下你的期待或祝福")).toBeTruthy();
  expect(screen.queryByText("选择最终形态")).toBeNull();
});
```

- [ ] **Step 2: Run and observe failure**

Run: `npm test -- --runInBand src/__tests__/criticalFlows.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement all three MVP surfaces**

Space screen separates human timeline, collapsible main-Agent card, and pet corner. Pet screen shows identity anchors, narrative growth diary, source-attributed memories, routine controls, and a shallow-participation evolution sheet. High-risk requests render a blocked policy explanation and never a confirm button.

- [ ] **Step 4: Verify**

Run: `npm test -- --runInBand src/__tests__/criticalFlows.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/screens src/components src/AppShell.tsx src/__tests__/criticalFlows.test.tsx
git commit -m "feat: complete space agents and lifelong pet flows"
```

### Task 8: Build verification, runbook, and production boundary

**Files:**
- Create: `README.md`
- Modify: `app.json`

**Interfaces:**
- Produces: exact local commands, demo walkthrough, acceptance matrix, and explicit production gaps.

- [ ] **Step 1: Document the runnable path**

README commands:

```bash
npm install
npm run web
npm test -- --runInBand
npm run typecheck
npm run export:web
```

The README must state that cloud autonomy, production E2EE, push notifications, real media upload, model calls, payments, and multi-user networking are not implemented by the local vertical prototype.

- [ ] **Step 2: Run the complete verification suite**

Run: `npm test -- --runInBand`
Expected: all tests PASS.

Run: `npm run typecheck`
Expected: exit 0.

Run: `npm run export:web`
Expected: `dist/` generated without errors.

- [ ] **Step 3: Visual smoke test**

Open the web build at a 390×844 viewport and verify dashboard, old-friends space, pet corner, delegation confirmation, memory boundaries, and evolution sheet. Fix layout or contrast regressions in the responsible component.

- [ ] **Step 4: Commit**

```bash
git add README.md app.json src
git commit -m "docs: add MVP runbook and production boundaries"
```

## Self-review

- Spec coverage: all eight acceptance scenarios map to Tasks 2–7.
- No placeholders: every deferred production capability is explicitly excluded, not left unspecified.
- Type consistency: `UserPet`, `SpaceMemoryVault`, `RelationshipSpace`, `DelegatedAction`, `EvolutionEvent`, `AgentCard`, and `PetCornerStory` originate only in `src/domain/types.ts`.
- Scope control: the implementation is a runnable vertical prototype; cloud backends and cryptographic infrastructure are not simulated as production-complete.
