import { DARK_THEME_PREFERENCES, DEFAULT_THEME_PREFERENCES, normalizeThemePreferences } from "../theme/preferences";
import { luminance, readableInk, themeFrom } from "../theme/palette";

test("the original default migrates to the accepted light design without losing interaction preferences",()=>{
  const prefs=normalizeThemePreferences({pageBackground:"#141329",cardBackground:"#211F40",primaryButton:"#FF806F",secondaryButton:"#34305E",dangerButton:"#9D4656",accent:"#79E0C1",reduceMotion:true,petReplyStyle:"detailed"});
  expect(prefs.appearance).toBe("light");expect(prefs.pageBackground).toBe(DEFAULT_THEME_PREFERENCES.pageBackground);
  expect(prefs.reduceMotion).toBe(true);expect(prefs.petReplyStyle).toBe("detailed");
});
test("a previously customized theme is preserved",()=>{
  const prefs=normalizeThemePreferences({pageBackground:"#FEFEFE",primaryButton:"#336633"});
  expect(prefs.appearance).toBe("custom");expect(themeFrom(prefs).page).toBe("#FEFEFE");expect(themeFrom(prefs).primary).toBe("#336633");
});
test("system appearance follows the device while an explicit choice stays stable",()=>{
  const prefs={...DEFAULT_THEME_PREFERENCES,appearance:"system" as const};
  expect(themeFrom(prefs,false).isDark).toBe(false);expect(themeFrom(prefs,true).isDark).toBe(true);
  expect(themeFrom(DEFAULT_THEME_PREFERENCES,true).isDark).toBe(false);
  expect(themeFrom(DARK_THEME_PREFERENCES,false).isDark).toBe(true);
});
test("default body and primary button foregrounds have readable contrast in both appearances",()=>{
  const ratio=(a:string,b:string)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
  for(const p of [DEFAULT_THEME_PREFERENCES,DARK_THEME_PREFERENCES]){
    const t=themeFrom(p);expect(ratio(t.text,t.card)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t.onPrimary,t.primary)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t.userText,t.userBubble)).toBeGreaterThanOrEqual(4.5);
  }
  expect(readableInk("#FFFFFF")).toBe("#171310");expect(readableInk("#000000")).toBe("#FFFFFF");
});
