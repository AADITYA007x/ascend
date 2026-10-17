// The daily summit: the hardest topic planned for today. Pure functions.
//
// The plan is rebuilt on every render and finished blocks drop out of it, so the day's summit is
// chosen once and saved ({ date, topicId, subjectId, kind, celebrated }) to stay put all day.

/** Session kind for a plan item kind. */
const sessionKind = (kind) => (kind === 'review' ? 'revision' : 'learn');

/**
 * The hardest of today's plan items, or null. `topics` should be the planner's copies
 * (planningTopics), whose difficulty already follows your ratings. A weak review counts one
 * step harder. Ties: learning before a review, then the longer block, then plan order.
 */
export function pickSummit(items = [], topics = []) {
  const byId = new Map(topics.map((t) => [t.id, t]));
  let best = null;
  items.forEach((item, i) => {
    const topic = byId.get(item.topicId);
    if (!topic) return;
    const c = {
      item,
      i,
      score: (Number(topic.difficulty) || 2) + (item.kind === 'review' && item.weak ? 1 : 0),
      learn: item.kind === 'review' ? 0 : 1,
      minutes: Number(item.minutes) || 0,
    };
    if (better(c, best)) best = c;
  });
  if (!best) return null;
  const { topicId, subjectId, kind } = best.item;
  return { topicId, subjectId, kind: kind === 'review' ? 'review' : 'learn' };
}

/** Strictly better, so the earlier block wins a full tie. */
function better(c, best) {
  if (!best) return true;
  if (c.score !== best.score) return c.score > best.score;
  if (c.learn !== best.learn) return c.learn > best.learn;
  return c.minutes > best.minutes;
}

/** Keeps today's saved summit, or picks a new one. { summit, changed } (changed → save it). */
export function resolveSummit({ stored, items, topics, today }) {
  if (stored?.date === today && topics.some((t) => t.id === stored.topicId)) return { summit: stored, changed: false };
  const pick = pickSummit(items, topics);
  if (!pick) return { summit: null, changed: false };
  return { summit: { date: today, ...pick, celebrated: false }, changed: true };
}

const matches = (summit, session, today) =>
  Boolean(summit) && summit.date === today && session.date === today && session.topicId === summit.topicId && (session.kind ?? 'learn') === sessionKind(summit.kind);

/** True once a session today has climbed today's summit. */
export function summitReached(summit, sessions, today) {
  return sessions.some((s) => matches(summit, s, today));
}

/** True when this new session reaches the summit for the first time today (time to celebrate). */
export function isSummitSession(summit, session, today) {
  return matches(summit, session, today) && !summit.celebrated;
}

/** True for the plan block that is today's summit. */
export function isSummitItem(summit, item) {
  return Boolean(summit) && item.topicId === summit.topicId && (item.kind === 'review' ? 'review' : 'learn') === summit.kind;
}
