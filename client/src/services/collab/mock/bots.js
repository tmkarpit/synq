import { getFileText, offsetToPosition } from '../workspaceDoc';
import { encodeRelative, decodeRelative } from '../relativePosition';

// Simulated collaborators for mock mode. They join, move their caret, select code and
// type a comment character by character in the file the host is viewing, then erase
// it again, so remote cursors can be demonstrated with a single tab.

export const BOT_ORIGIN = 'synq-bot';

const PROFILES = [
  {
    userId: 'bot-grace',
    username: 'grace',
    phrases: [
      '// TODO(grace): handle empty input',
      '// grace: nice, this reads well',
      '// review: extract a helper?',
    ],
  },
  {
    userId: 'bot-linus',
    username: 'linus',
    phrases: [
      '// linus: double-check the edge case',
      '// FIXME: rename before merging',
      '// perf looks fine here',
    ],
  },
];

const rand = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const pick = (list) => list[Math.floor(Math.random() * list.length)];

/**
 * host: {
 *   doc,
 *   getFileId(): string | null    file the bots should work in
 *   join(user) / leave(userId)     announce presence
 *   send(userId, event, payload)   relay cursor/selection/typing events
 * }
 */
export function createBotHost(host, { colors = [] } = {}) {
  const bots = new Map();
  const timers = new Set();
  let stopped = false;

  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.delete(id);
      if (!stopped) fn();
    }, ms);
    timers.add(id);
  };

  const textOf = (bot) => getFileText(host.doc, bot.fileId);

  const emitCaret = (bot, index, anchorIndex = index) => {
    const ytext = textOf(bot);
    if (!ytext) return;
    const text = ytext.toString();
    bot.index = Math.max(0, Math.min(index, text.length));
    const position = offsetToPosition(text, bot.index);
    host.send(bot.userId, 'cursor:move', {
      fileId: bot.fileId,
      position,
      rel: encodeRelative(ytext, bot.index),
    });
    const start = Math.min(anchorIndex, bot.index);
    const end = Math.max(anchorIndex, bot.index);
    if (start === end) {
      host.send(bot.userId, 'selection:change', { fileId: bot.fileId, range: null });
    } else {
      const s = offsetToPosition(text, start);
      const e = offsetToPosition(text, end);
      host.send(bot.userId, 'selection:change', {
        fileId: bot.fileId,
        range: {
          startLineNumber: s.lineNumber,
          startColumn: s.column,
          endLineNumber: e.lineNumber,
          endColumn: e.column,
        },
        rel: { start: encodeRelative(ytext, start), end: encodeRelative(ytext, end) },
      });
    }
  };

  const lineEnds = (text) => {
    const ends = [];
    for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) ends.push(i);
    ends.push(text.length);
    return ends;
  };

  const moveRandom = (bot) => {
    const ytext = textOf(bot);
    if (!ytext) return;
    const text = ytext.toString();
    const ends = lineEnds(text);
    const line = rand(0, ends.length - 1);
    const lineStart = line === 0 ? 0 : ends[line - 1] + 1;
    emitCaret(bot, rand(lineStart, ends[line]));
  };

  const selectRandom = (bot) => {
    const ytext = textOf(bot);
    if (!ytext) return;
    const text = ytext.toString();
    const ends = lineEnds(text);
    const line = rand(0, ends.length - 1);
    const lineStart = line === 0 ? 0 : ends[line - 1] + 1;
    const lineText = text.slice(lineStart, ends[line]);
    const words = [...lineText.matchAll(/[A-Za-z_$][\w$]*/g)];
    if (words.length && Math.random() < 0.6) {
      const w = pick(words);
      emitCaret(bot, lineStart + w.index + w[0].length, lineStart + w.index);
    } else {
      const indent = lineText.length - lineText.trimStart().length;
      emitCaret(bot, ends[line], lineStart + indent);
    }
  };

  const setTyping = (bot, typing) => {
    if (bot.typing === typing) return;
    bot.typing = typing;
    host.send(bot.userId, typing ? 'typing:start' : 'typing:stop', { fileId: bot.fileId });
  };

  // Types "\n<indent><phrase>" after the end of a random line, one character per tick.
  const typePhrase = (bot, done) => {
    const ytext = textOf(bot);
    if (!ytext) return done();
    const text = ytext.toString();
    const ends = lineEnds(text);
    if (ends.length < 3) return done();
    const line = rand(0, Math.max(0, ends.length - 2));
    const lineStart = line === 0 ? 0 : ends[line - 1] + 1;
    const indent = text.slice(lineStart).match(/^[ \t]*/)[0];
    const insert = `\n${indent}${pick(bot.phrases)}`;
    const at = ends[line];
    // assoc -1: the anchor sticks to the character before it, so our own inserts land after it.
    bot.typed = { rel: encodeRelative(ytext, at, -1), text: '', fileId: bot.fileId };
    emitCaret(bot, at);
    setTyping(bot, true);

    let i = 0;
    const step = () => {
      const t = textOf(bot);
      const start = decodeRelative(host.doc, t, bot.typed?.rel);
      if (!t || start == null || bot.fileId !== bot.typed.fileId) {
        bot.typed = null;
        setTyping(bot, false);
        return done();
      }
      const pos = start + i;
      host.doc.transact(() => t.insert(pos, insert[i]), BOT_ORIGIN);
      bot.typed.text += insert[i];
      i += 1;
      emitCaret(bot, pos + 1);
      if (i < insert.length) {
        later(step, rand(45, 140));
      } else {
        later(() => setTyping(bot, false), 1500);
        done();
      }
      return undefined;
    };
    later(step, 250);
    return undefined;
  };

  // Backspaces the bot's own phrase if nobody changed it in the meantime.
  const erasePhrase = (bot, done) => {
    const typed = bot.typed;
    const ytext = textOf(bot);
    const start = decodeRelative(host.doc, ytext, typed?.rel);
    if (
      !typed ||
      !ytext ||
      start == null ||
      ytext.toString().slice(start, start + typed.text.length) !== typed.text
    ) {
      bot.typed = null;
      return done();
    }
    setTyping(bot, true);
    let remaining = typed.text.length;
    const step = () => {
      const t = textOf(bot);
      const s = decodeRelative(host.doc, t, typed.rel);
      if (!t || s == null) {
        bot.typed = null;
        setTyping(bot, false);
        return done();
      }
      host.doc.transact(() => t.delete(s + remaining - 1, 1), BOT_ORIGIN);
      remaining -= 1;
      emitCaret(bot, s + remaining);
      if (remaining > 0) later(step, rand(25, 60));
      else {
        bot.typed = null;
        later(() => setTyping(bot, false), 1500);
        done();
      }
      return undefined;
    };
    later(step, 400);
    return undefined;
  };

  const tick = (bot) => {
    if (stopped) return;
    const next = () => later(() => tick(bot), rand(900, 2200));
    const target = host.getFileId();
    if (target && target !== bot.fileId && !bot.typed) {
      bot.fileId = target;
      host.join({ ...bot.user, fileId: target });
      moveRandom(bot);
      return next();
    }
    if (!bot.fileId || !textOf(bot)) return next();

    const roll = Math.random();
    if (bot.typed) {
      if (roll < 0.5) return erasePhrase(bot, next);
      moveRandom(bot);
    } else if (roll < 0.4) moveRandom(bot);
    else if (roll < 0.7) selectRandom(bot);
    else return typePhrase(bot, next);
    return next();
  };

  PROFILES.forEach((profile, i) => {
    const user = {
      userId: profile.userId,
      username: profile.username,
      color: colors[i],
      role: 'editor',
      isBot: true,
      fileId: null,
    };
    const bot = {
      ...profile,
      user,
      joined: false,
      fileId: null,
      index: 0,
      typing: false,
      typed: null,
    };
    bots.set(profile.userId, bot);
    later(
      () => {
        bot.joined = true;
        host.join(user);
        tick(bot);
      },
      600 + i * 900,
    );
  });

  return {
    users: () =>
      [...bots.values()].filter((b) => b.joined).map((b) => ({ ...b.user, fileId: b.fileId })),
    has: (userId) => bots.has(userId),
    stop() {
      if (stopped) return;
      stopped = true;
      timers.forEach(clearTimeout);
      timers.clear();
      // Remove any half-typed phrase so the shared file stays clean.
      bots.forEach((bot) => {
        const ytext = textOf(bot);
        const start = decodeRelative(host.doc, ytext, bot.typed?.rel);
        if (
          ytext &&
          start != null &&
          ytext.toString().slice(start, start + bot.typed.text.length) === bot.typed.text
        ) {
          host.doc.transact(() => ytext.delete(start, bot.typed.text.length), BOT_ORIGIN);
        }
        if (bot.joined) host.leave(bot.userId);
      });
      bots.clear();
    },
  };
}
