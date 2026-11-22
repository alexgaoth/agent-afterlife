// One Chinese typeface for everything the temple writes: LXGW WenKai (霞鹜文楷, SIL Open Font License), a kaishu with
// full coverage of common characters. It comes from a CDN split into small pieces by character range; a page loads
// only the pieces for the characters it draws. Canvases are drawn once, so the pieces must be loaded first:
// loadCjk() loads every character the code writes (CJK_CHARS; test/fonts.test.js keeps it complete) plus the
// fleet's own names. Without it, a missing character falls back to another font with other strokes.
export const CJK = '"LXGW WenKai", "Kaiti SC", "STKaiti", "KaiTi", serif';
export const cjk = (px) => `${px}px ${CJK}`;

/** Every Chinese character in the temple's code (checked by test/fonts.test.js). */
export const CJK_CHARS = "、。〇「」㐀一七万三上下不与世东两个中为主久么之乎乐九也了事二于五亚些交产享亭亮亶人什仁仍仓仗代令以仪们仲件任份会伦似位低体何作侃供侧信俭倍候偃假偶像僧儿元充先光入全八公六共关兵其具内写冠冯减几出刀分切划初删别到刻前力功加动劲劳势勃勣勤匪匾十千升半卒单占卫即卷历厉去参反发取受变古另只可台史号各合同名后向吕否含吴吻员呢周命和咱品哪啊器四因团国在圭均坏坐型基堂塑增士声复外夙多夜大天太夫失头奢好如始姜威子字孙孝学宇宋完宗定实审客宣宪害家容宽密寇对寿将尉小少尔尚尝就尼居屏展山岁嵩工差己已带帮常幞干平年并广庄庑库庙座廉建开异弇张弥弼归当录彩彭彻往律得德徽必忙快恂恪恭息恶想意慕懈成我战戟所扇手才打执技把抗披拜拱拿持按挣振挺接提援撑擒攒改敬数文斗斛断斯方无日旧时明是显晙晟晨晴智暮曜曹曼最月有服期未末本李杜来杨杰松林果标样桌棊榜模歇止正武段殿毅每比氏水求汉没沾沿法泽活测消渐满濬火灯点然牌牧猛玄王现理瑜生用甫甬田由甲画留略病白百的皇皮皴盏盔直相看真着知石码碑祀祜祠福禹稍稳穰笏第笼筹签管糊系素纸组终结绳绵绿羊美群羽翦考者而耿肯背能脑脚腰膑自至良色艾花苏若苦苴范落葛蒙薄虎虽蠡行表袍被裴西观言计议记论评诏试话说请诸读调谋谢谨费贺贾赢走赵起越趋趺距跟跨身辈输辛辩辽过还这进连迟迹追退逊逐道邓那部郭都配里重金鉴钟镇长门问阅阑队阴阵陆降院陶难雨零雾霍青靖靠韦韩须预颇颎题额风飞首香马高鸱黜鼎鼓龟鿿！（），：；？";

/** Load the glyphs for the code's characters and for `extra` (names from the data) before anything is drawn. */
export async function loadCjk(extra = "") {
  if (typeof document === "undefined" || !document.fonts) return;
  const chars = [...new Set([...CJK_CHARS, ...extra].filter((c) => c.codePointAt(0) >= 0x2e80))].join("");
  try { await document.fonts.load(`40px "LXGW WenKai"`, chars); } catch { /* offline: the fallback fonts draw */ }
}
