// The fleet as it stood on a given day, for the temple's timeline. Pure: schema in, schema out.
//   An agent exists from its first day. Before its last day it is alive; its merit so far is its merit times the
//   share of its series (value x weight) that falls on or before the day. Edicts after the day are not issued yet.
// Generations keep their numbers: the n-th bearer of a name is the n-th whichever day you look at.

/** Every day the fleet has a record for, oldest first (YYYY-MM-DD). */
export function days(data) {
  const set = new Set();
  for (const a of data.agents) {
    set.add(a.born.slice(0, 10));
    if (a.ended) set.add(a.ended.slice(0, 10));
    for (const s of a.series || []) set.add(s.date.slice(0, 10));
  }
  return [...set].sort();
}

/** The document as of the end of `day`. */
export function asOf(data, day) {
  const agents = [];
  for (const a of data.agents) {
    if (a.born.slice(0, 10) > day) continue;
    const series = (a.series || []).filter((s) => s.date.slice(0, 10) <= day);
    const done = a.status === "ended" && a.ended && a.ended.slice(0, 10) <= day;
    const total = (a.series || []).reduce((t, s) => t + s.value * (s.weight ?? 1), 0);
    const share = done ? 1 : total > 0 ? series.reduce((t, s) => t + s.value * (s.weight ?? 1), 0) / total : 0;
    const { ended, ...rest } = a;
    agents.push({ ...rest, ...(done ? { ended } : {}), status: done ? "ended" : "alive", merit: Math.round(a.merit * share * 100) / 100, series });
  }
  return { ...data, agents, edicts: (data.edicts || []).filter((e) => e.date.slice(0, 10) <= day), generated: `${day}T23:59:59Z` };
}

/**
 * The temple's weather for a day: its merit against the fleet's usual day (the median of days with work).
 * clear at 1.2x or more, a thin mist from 0.8x, overcast from 0.35x, rain below that (or no work at all).
 */
export function weatherFor(merit, usual) {
  if (!(usual > 0)) return "clear";
  const r = merit / usual;
  return r >= 1.2 ? "clear" : r >= 0.8 ? "mist" : r >= 0.35 ? "overcast" : "rain";
}
