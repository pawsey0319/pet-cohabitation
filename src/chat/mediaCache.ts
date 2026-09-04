export async function resolveCachedMedia(
  _ownerId: string,
  _storagePath: string,
  getSignedUrl: () => Promise<string>,
): Promise<string> {
  return getSignedUrl();
}

export async function clearMediaCache(_ownerId: string): Promise<void> {}

export async function invalidateCachedMedia(_ownerId: string, _storagePath: string): Promise<void> {}
