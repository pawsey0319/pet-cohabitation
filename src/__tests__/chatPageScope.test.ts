import { ChatPageScope } from "../chat/pageScope";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
};

it("does not merge a late history page after membership was revoked", async () => {
  const scope = new ChatPageScope(); scope.select("owner", "group"); scope.begin();
  const valid = scope.capture(), request = deferred<string[]>();
  let visible = ["recent"];
  const loading = request.promise.then(rows => { if (valid()) visible = [...rows, ...visible]; });
  scope.revoke(); visible = [];
  request.resolve(["protected history"]); await loading;
  expect(visible).toEqual([]);
});

it("does not show old mentions or invites when navigating to another account and back", async () => {
  const scope = new ChatPageScope(); scope.select("first", "group"); scope.begin();
  const valid = scope.capture(), request = deferred<string[]>();
  let targets: string[] = [];
  const loading = request.promise.then(rows => { if (valid()) targets = rows; });
  scope.select("second", "other-group"); scope.begin();
  scope.select("first", "group"); const current = scope.begin();
  request.resolve(["old private contact"]); await loading;
  expect(targets).toEqual([]); expect(current()).toBe(true);
});

it("invalidates pending callbacks during render scope changes before effect cleanup", () => {
  const scope = new ChatPageScope(); scope.select("owner", "one"); scope.begin();
  const old = scope.capture();
  scope.select("owner", "two");
  expect(old()).toBe(false); expect(scope.capture()()).toBe(false);
  const next = scope.begin(); expect(next()).toBe(true);
  scope.begin(); expect(next()).toBe(false);
});
