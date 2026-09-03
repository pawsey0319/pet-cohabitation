import { createPetRepository } from "../data/petRepository";

jest.mock(
  "@react-native-async-storage/async-storage",
  () => require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

const ownPet = {
  id: "pet-own",
  owner_id: "owner",
  name: "自己的异宠",
  status: "incubating",
  current_asset_id: null,
  confirmed_at: null,
};
const ownAsset = {
  id: "asset-own",
  pet_id: "pet-own",
  storage_path: "owner/own.png",
  parent_asset_id: null,
  evolution_event_id: null,
  is_draft: true,
  created_at: "2026-09-03T09:00:00.000Z",
};
const sharedAsset = {
  ...ownAsset,
  id: "asset-shared",
  pet_id: "pet-shared",
  storage_path: "other/shared.png",
  is_draft: false,
};

function ownerPetQuery() {
  return {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: ownPet, error: null }),
      }),
    }),
  };
}

function runtimeQuery() {
  let petId: string | null = null;
  const builder = {
    eq: (_column: string, value: string) => {
      petId = value;
      return builder;
    },
    maybeSingle: async () =>
      petId === ownPet.id
        ? { data: null, error: null }
        : {
            data: null,
            error: {
              code: "PGRST116",
              details: "The result contains 2 rows",
              message: "JSON object requested, multiple rows returned",
            },
          },
  };
  return { select: () => builder };
}

function assetQuery() {
  let petId: string | null = null;
  const builder = {
    eq: (_column: string, value: string) => {
      petId = value;
      return builder;
    },
    order: async () => ({
      data: petId === ownPet.id ? [ownAsset] : [ownAsset, sharedAsset],
      error: null,
    }),
  };
  return { select: () => builder };
}

const mockFrom = jest.fn((table: string) => {
  if (table === "pets") return ownerPetQuery();
  if (table === "pet_runtime_states") return runtimeQuery();
  if (table === "pet_visual_assets") return assetQuery();
  throw new Error(`Unexpected table ${table}`);
});

jest.mock("../lib/supabase", () => ({
  isLocalDemoMode: false,
  requireSupabase: () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "owner" } } }),
    },
    from: (table: string) => mockFrom(table),
  }),
}));

describe("pet repository owner scoping", () => {
  const repository = createPetRepository({
    id: "owner",
    email: "owner@example.test",
    nickname: "主人",
    isAdmin: false,
  });

  beforeEach(() => mockFrom.mockClear());

  it("does not treat other group pets' runtime rows as the owner's runtime state", async () => {
    await expect(repository.getRuntimeState()).resolves.toBeNull();
  });

  it("does not include other group pets' portraits in the owner's candidate list", async () => {
    const assets = await repository.listAssets();

    expect(assets.map((asset) => asset.id)).toEqual(["asset-own"]);
  });
});
