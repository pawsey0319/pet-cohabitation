/** Expo Router can return repeated search parameters as an array. */
export function workRouteParam(value: string | string[] | undefined): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || undefined;
}
