import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canon, guessScore, drawerScore, hintTimes, judgeGuess, leaksWord, makePattern, mergeSettings,
  parseCustomWords, sanitizeAvatar, sanitizeName, initialSettings, randomCode,
} from '../src/logic';
import { BUNDLED_WORDS } from '../src/words';
import { DEFAULT_SETTINGS, LANGUAGES } from '../../shared/protocol';

test('canon strips case, accents and punctuation', () => {
  assert.equal(canon('  Ice-Cream! '), 'icecream');
  assert.equal(canon('Crêpe'), 'crepe');
});

test('judgeGuess', () => {
  assert.equal(judgeGuess('ICE cream', 'ice cream'), 'correct');
  assert.equal(judgeGuess('icecream', 'ice cream'), 'correct');
  assert.equal(judgeGuess('aple', 'apple'), 'close');
  assert.equal(judgeGuess('cat', 'cap'), 'wrong'); // short words never "close"
  assert.equal(judgeGuess('banana', 'apple'), 'wrong');
  assert.equal(judgeGuess('   ', 'apple'), 'wrong');
});

test('leaksWord detects the word inside a sentence', () => {
  assert.ok(leaksWord("it's a Dog!", 'dog'));
  assert.ok(!leaksWord('looks like a pet', 'dog'));
});

test('makePattern keeps separators and reveals letters', () => {
  assert.equal(makePattern('ice cream', []), '___ _____');
  assert.equal(makePattern('ice cream', [0, 8]), 'i__ ____m');
  assert.equal(makePattern('t-shirt', []), '_-_____');
});

test('scores are speed based and bounded', () => {
  assert.equal(guessScore(80_000, 80_000), 500);
  assert.equal(guessScore(0, 80_000), 50);
  assert.ok(guessScore(60_000, 80_000) > guessScore(20_000, 80_000));
  assert.equal(guessScore(-5, 80_000), 50);
  assert.equal(drawerScore([]), 0);
  assert.equal(drawerScore([100, 300]), 200);
});

test('hint schedule is evenly spaced and never reveals the whole word', () => {
  assert.deepEqual(hintTimes(0, 90_000, 2, 'house'), [30_000, 60_000]);
  assert.equal(hintTimes(0, 90_000, 5, 'at').length, 1);
  assert.equal(hintTimes(0, 90_000, 0, 'house').length, 0);
});

test('mergeSettings clamps and validates', () => {
  const s = mergeSettings(DEFAULT_SETTINGS, { rounds: 99, drawTime: 1, maxPlayers: 3, lang: 'xx', hints: -4, guessChat: 'open' });
  assert.equal(s.rounds, 10);
  assert.equal(s.drawTime, 15);
  assert.equal(s.maxPlayers, 3);
  assert.equal(s.lang, 'en');
  assert.equal(s.hints, 0);
  assert.equal(s.guessChat, 'open');
  assert.equal(mergeSettings(s, { maxPlayers: 2 }, 5).maxPlayers, 5); // cannot go below current players
  assert.equal(initialSettings({ lang: 'de' }).lang, 'de');
});

test('parseCustomWords dedupes, lowercases and rejects junk', () => {
  assert.deepEqual(parseCustomWords('Apple, apple\nIce Cream,<script>,,  x'), ['apple', 'ice cream', 'x']);
});

test('sanitizers', () => {
  assert.equal(sanitizeName('  <b>Bob</b>\n'), 'bBob/b');
  assert.equal(sanitizeName(''), 'Player');
  assert.equal(sanitizeName('x'.repeat(100)).length, 20);
  assert.deepEqual(sanitizeAvatar({ color: 999, eyes: -1, mouth: 'a', acc: 3 }), { color: 0, eyes: 0, mouth: 0, acc: 3 });
  assert.match(randomCode(), /^[a-z0-9]{8}$/);
});

test('every language has a bundled pack with enough words', () => {
  for (const l of LANGUAGES) {
    const w = BUNDLED_WORDS[l.code];
    assert.ok(w && w.length >= 100, `${l.code} has ${w?.length}`);
    assert.ok(w.every((x) => x.length <= 32 && x === x.toLowerCase()));
  }
  assert.ok(BUNDLED_WORDS.en.length >= 600);
});
