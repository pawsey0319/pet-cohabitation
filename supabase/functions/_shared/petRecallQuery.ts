export function recallSpaceMatches(question: string, spaceName: string): boolean {
  if (question.includes(spaceName)) return true;
  const compact = spaceName.replace(/(?:关系)?空间|群聊|互动|测试|小组|群/g, "").replace(/\s+/g, "");
  return compact.length >= 2 && question.replace(/\s+/g, "").includes(compact);
}

export function recallKeywords(question: string, spaceNames: readonly string[]): readonly string[] {
  const found = [...question.matchAll(/[“\"']([^”\"']{1,30})[”\"']/g)].map((match) => match[1]);
  const about = question.match(/(?:关于|有关|提到|说起)([^，。？！?]{1,24}?)(?:的事|时|吗|呢|说|聊|消息|安排|$)/);
  if (about?.[1]) found.push(about[1]);
  return [...new Set(found.map((item) => item.trim()).filter((item) => item.length >= 1 && !spaceNames.some((name) => name.includes(item))))].slice(0, 8);
}
