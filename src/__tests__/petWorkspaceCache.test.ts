import { PetWorkspaceCache } from "../pets/workspaceCache";
test("parallel panels share one slow request and warm reads return without waiting for refresh", async () => {
  jest.useFakeTimers();
  const cache = new PetWorkspaceCache(); let resolve!: (value: string) => void;
  const fetch = jest.fn(() => new Promise<string>(done => { resolve = done; }));
  const first = cache.read("dashboard", fetch), second = cache.read("dashboard", fetch);
  expect(fetch).toHaveBeenCalledTimes(1); resolve("pet");
  expect(await first).toBe("pet"); expect(await second).toBe("pet");
  jest.advanceTimersByTime(31_000);
  expect(await cache.read("dashboard", fetch)).toBe("pet");
  expect(fetch).toHaveBeenCalledTimes(2); resolve("updated"); await Promise.resolve();
  expect(await cache.read("dashboard", fetch)).toBe("updated");
  cache.dispose(); jest.useRealTimers();
});
test("logout and invalidation fence late network responses", async () => {
  const cache = new PetWorkspaceCache(); let resolve!: (value: string) => void;
  const pending = cache.read("private", () => new Promise<string>(done => { resolve = done; }));
  const rejected = expect(pending).rejects.toThrow("pet_cache_invalidated");
  cache.dispose(); resolve("former-owner-private-data"); await rejected;
  expect(cache.peek("private")).toBeUndefined();
  await expect(cache.read("private", async () => "other")).rejects.toThrow("pet_session_changed");
});

 test("a two-second network delay cannot block warm module reads", async () => {
  jest.useFakeTimers();
  try {
   const cache = new PetWorkspaceCache();
   await cache.read("dashboard",async()=>"cached");
   jest.advanceTimersByTime(31_000);
   const slow=jest.fn(()=>new Promise(resolve=>setTimeout(()=>resolve("fresh"),2000)));
   const started=Date.now();
   expect(await cache.read("dashboard",slow)).toBe("cached");
   expect(await cache.read("dashboard",slow)).toBe("cached");
   expect(Date.now()-started).toBe(0);expect(slow).toHaveBeenCalledTimes(1);
   await jest.advanceTimersByTimeAsync(1999);expect(cache.peek("dashboard")).toBe("cached");
   await jest.advanceTimersByTimeAsync(1);expect(cache.peek("dashboard")).toBe("fresh");
   cache.dispose();
  } finally {jest.useRealTimers();}
 });
