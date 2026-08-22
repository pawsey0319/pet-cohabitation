declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void };

export function runInBackground(task: Promise<unknown>): void {
  EdgeRuntime.waitUntil(task);
}
