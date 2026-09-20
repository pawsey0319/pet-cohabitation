export function recallSpaceMatches(question: string, spaceName: string): boolean {
  if (question.includes(spaceName)) return true;
  const compact = spaceName.replace(/(?:关系)?空间|群聊|互动|测试|小组|群/g, "").replace(/\s+/g, "");
  return compact.length >= 2 && question.replace(/\s+/g, "").includes(compact);
}

export function recallKeywords(question: string, spaceNames: readonly string[]): readonly string[] {
  const found = [...question.matchAll(/[“\"']([^”\"']{1,30})[”\"']/g)].map((match) => match[1]);
  const about = question.match(/(?:关于|有关|提到|说起)([^，。？！?]{1,24}?)(?:的事|时|吗|呢|说|聊|消息|安排|$)/);
  if (about?.[1]) {
    // “关于这个群最近大家都聊了什么” names a summary, not a topic to
    // search through 4,000 historical messages. Explicit quoted terms remain
    // literal searches, including otherwise generic words such as “消息”.
    let topic = about[1].trim();
    for (const name of spaceNames) topic = topic.replaceAll(name, "");
    const meaningful = topic.replace(/最近|近期|之前|以前|刚才|现在|今天|昨天|大家|我们|你们|他们|这个|那个|这些|那些|群聊|群里|群内|群中|群|关系空间|空间|什么|哪些|一些|一下|内容|事情|情况|近况|话题|讨论|聊天|记录|总结|回顾|全部|所有|都|在|的|了|有|过|着|啊|呀|吧|呢|\s/g, "");
    if (meaningful) found.push(about[1]);
  }
  return [...new Set(found.map((item) => item.trim()).filter((item) => item.length >= 1 && !spaceNames.some((name) => name.includes(item))))].slice(0, 8);
}
