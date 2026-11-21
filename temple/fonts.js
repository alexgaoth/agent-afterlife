// One Chinese typeface for everything the temple writes: LXGW WenKai (霞鹜文楷, SIL Open Font License), a kaishu with
// full coverage of common characters. It comes from a CDN split into small pieces by character range; a page loads
// only the pieces for the characters it draws. Canvases are drawn once, so the pieces must be loaded first:
// loadCjk() loads every character the code writes (CJK_CHARS; test/fonts.test.js keeps it complete) plus the
// fleet's own names. Without it, a missing character falls back to another font with other strokes.
export const CJK = '"LXGW WenKai", "Kaiti SC", "STKaiti", "KaiTi", serif';
export const cjk = (px) => `${px}px ${CJK}`;

/** Every Chinese character in the temple's code (checked by test/fonts.test.js). */
export const CJK_CHARS = "。〇㐀一七万三上不世东两中临为主之乐九也事二于五亚交亦享亭亮亶人仁今代以仪仲众会伦位作侃供侧信俭偃像僧元充光入八公六关其冠冯决凛出刀则初刻前力功动劳勃勉勣勤匪匾十千升卒单卫卷去参及古可台史合名后向吕否吴吻吾周和品哗善喧四国在堂塑增声复外夙夜大天太夫失头奢如姜威子存孙孝学宇宋宗定审客宣宪容宽寇寡寿将尉尘尽屏展山岁嵩师席帷幄幞平年并广庑庙座廉建异弇张弥弼当彩彭彻律得微德徽恂恪恭恶愧愿慕懈成战戟所扇手执技抗披拜拱振提援擒效敢敬数文斗斛方无日时明昔晙晟晨晴暗暮曜曹月有望未李杜杨杰松林桌棊正此武段殿毅氏水汉法泽浅濬火灯然牌牧犹猛玄王理瑜生甫甬田由甲画病白百皆皇皴盛相真矣知石碑祀祜祠禹积穆穰立笏第笼筹管系素纸绝继续绵绿羊群羽翦考者而耿肃背胜脚膑自至良色艾苏若苴范莫葛蒙薄虎虚虽蠡行表裴西见观言诏话请诸读谋谢谨贺贾赵起越足趺跨身轴载辈辩辽过运进迟退逊逝道邓郭配里金鉴钟镇长门阑阴阵陆降院陶随雨雾霍青靖非韦韩须预颇颎额飞香马高鸱黜鼎鼓龟鿿，？";

/** Load the glyphs for the code's characters and for `extra` (names from the data) before anything is drawn. */
export async function loadCjk(extra = "") {
  if (typeof document === "undefined" || !document.fonts) return;
  const chars = [...new Set([...CJK_CHARS, ...extra].filter((c) => c.codePointAt(0) >= 0x2e80))].join("");
  try { await document.fonts.load(`40px "LXGW WenKai"`, chars); } catch { /* offline: the fallback fonts draw */ }
}
