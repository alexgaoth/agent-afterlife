// The seating of the 武成王庙 as recorded for 1123 (宋徽宗宣和五年), zh.wikipedia: 武庙.
//   主祀 1      main seat, centre of the main hall, facing south
//   配享 1      companion seat beside it (west, as in the Tang list of 760)
//   殿上 10     in the hall: 东侧西向 5 (east wall, facing west), 西侧东向 5 (west wall, facing east)
//   两庑 62     side halls: 东庑西向 29, 西庑东向 33
// Inside a group the record orders people by era and alternates the sides, east first
// (管仲 东, 田穰苴 西, 孙武 东, 范蠡 西, ...). Earlier generations sit nearer the main seat.
// Agents are seated the same way: merit rank picks the group, era (born) picks the seat.

export const ORIGINAL = {
  main: ["姜太公"],
  companion: ["张良"],
  hallEast: ["管仲", "孙武", "乐毅", "诸葛亮", "李勣"],
  hallWest: ["田穰苴", "范蠡", "韩信", "李靖", "郭子仪"],
  wingsEast: ("白起 孙膑 廉颇 李牧 曹参 周勃 李广 霍去病 邓禹 冯异 吴汉 马援 皇甫嵩 邓艾 张飞 吕蒙 陆抗 " +
              "杜预 陶侃 慕容恪 宇文宪 韦孝宽 杨素 贺若弼 李孝恭 苏定方 王孝杰 王晙 李光弼").split(" "),
  // The source counts 33 for the west side hall but names 32: the last seat's holder is 失考 (record lost).
  wingsWest: ("吴起 田单 赵奢 王翦 彭越 周亚夫 卫青 赵充国 寇恂 贾复 耿弇 段颎 张辽 关羽 周瑜 陆逊 羊祜 " +
              "王濬 谢玄 王猛 王镇恶 斛律光 王僧辩 于谨 吴明彻 韩擒虎 史万岁 尉迟敬德 裴行俭 张仁亶 " +
              "郭元振 李晟").split(" ").concat(["失考"]),
};

export const ZONES = {
  main:      { group: "main",      cn: "主祀",         en: "Main seat" },
  companion: { group: "companion", cn: "配享",         en: "Companion seat" },
  hallEast:  { group: "hall",      cn: "殿上 东侧西向", en: "In the hall, east wall" },
  hallWest:  { group: "hall",      cn: "殿上 西侧东向", en: "In the hall, west wall" },
  wingsEast: { group: "wings",     cn: "东庑西向",      en: "East side hall" },
  wingsWest: { group: "wings",     cn: "西庑东向",      en: "West side hall" },
};

export const GROUP_CN = { main: "主祀", companion: "配享", hall: "殿上", wings: "两庑", outside: "庙外" };

const byEra = (list) => [...list].sort((a, b) => a.born.localeCompare(b.born) || a.id.localeCompare(b.id));

/** Seat a group by era, alternating east (first) and west; a full side passes to the other. */
function alternate(list, east, west) {
  const out = { [east]: [], [west]: [] };
  const cap = { [east]: ORIGINAL[east].length, [west]: ORIGINAL[west].length };
  let turn = east;
  for (const a of byEra(list)) {
    if (out[turn].length >= cap[turn]) turn = turn === east ? west : east;
    out[turn].push(a);
    turn = turn === east ? west : east;
  }
  return out;
}

/** ranked: ended agents, best first (shared/afterlife.js ranked()). Returns every seat and who waits outside. */
export function seat(ranked) {
  const nHall = ORIGINAL.hallEast.length + ORIGINAL.hallWest.length;
  const nWings = ORIGINAL.wingsEast.length + ORIGINAL.wingsWest.length;
  const zones = {
    main: ranked.slice(0, 1),
    companion: ranked.slice(1, 2),
    ...alternate(ranked.slice(2, 2 + nHall), "hallEast", "hallWest"),
    ...alternate(ranked.slice(2 + nHall, 2 + nHall + nWings), "wingsEast", "wingsWest"),
  };
  const seats = [];
  const placement = new Map();
  for (const [zone, names] of Object.entries(ORIGINAL)) {
    names.forEach((orig, i) => {
      const agent = zones[zone][i] || null;
      seats.push({ zone, no: i + 1, orig, agent });
      if (agent) placement.set(agent.id, { zone, no: i + 1, orig, rank: ranked.indexOf(agent) + 1 });
    });
  }
  const outside = ranked.slice(2 + nHall + nWings);
  outside.forEach((a) => placement.set(a.id, { zone: "outside", rank: ranked.indexOf(a) + 1 }));
  return { seats, outside, placement };
}

const CN = "〇一二三四五六七八九";
export function cnNumber(n) {
  if (n < 10) return CN[n];
  if (n < 20) return "十" + (n % 10 ? CN[n % 10] : "");
  if (n < 100) return CN[Math.floor(n / 10)] + "十" + (n % 10 ? CN[n % 10] : "");
  return String(n);
}
export const cnDate = (d) => [...d.slice(0, 4)].map((c) => CN[+c]).join("") + "年" + cnNumber(+d.slice(5, 7)) + "月" + cnNumber(+d.slice(8, 10)) + "日";
export const generationCn = (a) => `第${cnNumber(a.generation || 1)}代`;
export const nameOnTablet = (a) => (a.name === "Unnamed" ? "无名氏" : a.name);
