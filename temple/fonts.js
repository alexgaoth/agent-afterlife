// One Chinese typeface for everything the temple writes: LXGW WenKai (霞鹜文楷, SIL Open Font License), a kaishu with
// full coverage of common characters. It comes from a CDN split into small pieces by character range; a page loads
// only the pieces for the characters it draws. Canvases are drawn once, so the pieces must be loaded first:
// loadCjk() loads every character the code writes (CJK_CHARS; test/fonts.test.js keeps it complete) plus the
// fleet's own names. Without it, a missing character falls back to another font with other strokes.
export const CJK = '"LXGW WenKai", "Kaiti SC", "STKaiti", "KaiTi", serif';
export const cjk = (px) => `${px}px ${CJK}`;

/** Every Chinese character in the temple's code (checked by test/fonts.test.js). */
export const CJK_CHARS = "。〇㐀一七万三上不世东两个主么之乐九也了事二于五亚交享亭亮亶人什仁仗代以仪们仲件份会伦似位侃供侧信俭偃假像僧儿元充光入八公六关兵写冠冯几出刀初别到刻前功加动劲劳勃勣勤匪匾十千升卒单占卫卷厉去参古可台史合名后向吕吴吻员呢周和咱品啊器四国在坐堂塑声复外夙多夜大天太夫失头奢好如姜威子字孙孝学宇宋完宗定实客宣宪害家容宽寇寿将尉小少就屏展山岁嵩帮幞干平年并广庄庑庙座廉建异弇张弥弼当彩彭彻律得德徽快恂恪恭恶想意慕懈成我战戟扇手才打技把抗披拜拱拿振挺接提援擒攒敬数文斗斛断方无日明是晙晟晨晴暮曜曹最月有服李杜杨杰松林样桌棊榜正武段殿毅氏水求汉没沾法泽活濬火灯点然牌牧猛玄王现理瑜生甫甬田甲画病白百的皇皴盏盔直看真着知石码碑祀祜祠禹穰立笏第笼管系素纸绵绿羊群羽翦考耿背能脑脚膑自良色艾苏若苦苴范葛蒙薄虎虽蠡行表裴西言记诏话说请诸读谢谨贺贾赢走赵起越趺跟跨身轴辈辛辩辽过还这进迟追退逊道邓那郭都配里重金鉴钟镇长门阑阴阵陆降院陶雨雾霍青靖靠韦韩须预颇颎额风飞香马高鸱黜鼎鼓龟鿿，？";

/** Load the glyphs for the code's characters and for `extra` (names from the data) before anything is drawn. */
export async function loadCjk(extra = "") {
  if (typeof document === "undefined" || !document.fonts) return;
  const chars = [...new Set([...CJK_CHARS, ...extra].filter((c) => c.codePointAt(0) >= 0x2e80))].join("");
  try { await document.fonts.load(`40px "LXGW WenKai"`, chars); } catch { /* offline: the fallback fonts draw */ }
}
