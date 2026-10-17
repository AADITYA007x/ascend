import { describe, it, expect } from 'vitest';
import { parseClientMessage, rateLimit, publicMember, PROTOCOL, IDLE } from '../rooms/src/protocol.js';

const NOW = 1_800_000_000_000;
const ID = 'device-1234-abcd';
const parse = (m) => parseClientMessage(typeof m === 'string' ? m : JSON.stringify(m), NOW);

describe('parseClientMessage', () => {
  it('accepts a hello, cleaning the name and starting idle', () => {
    expect(parse({ type: 'hello', id: ID, name: '  Asha  ' })).toEqual({ ok: true, msg: { type: 'hello', id: ID, name: 'Asha', presence: IDLE } });
  });
  it('refuses a bad id or a too-short name', () => {
    expect(parse({ type: 'hello', id: 'short', name: 'Asha' }).error).toBe('bad-id');
    expect(parse({ type: 'hello', id: 'has spaces in it', name: 'Asha' }).error).toBe('bad-id');
    expect(parse({ type: 'hello', id: ID, name: ' A ' }).error).toBe('bad-name');
  });
  it('accepts a presence and keeps only what it knows', () => {
    const p = { type: 'presence', status: 'focus', endsAt: NOW + 60000, subject: 'Physics', todayMin: 30, rounds: 1, topic: 'secret' };
    expect(parse(p)).toEqual({ ok: true, msg: { type: 'presence', status: 'focus', endsAt: NOW + 60000, subject: 'Physics', todayMin: 30, rounds: 1 } });
  });
  it('refuses presences that don’t add up', () => {
    const base = { type: 'presence', status: 'focus', endsAt: NOW + 60000, subject: null, todayMin: 0, rounds: 0 };
    expect(parse({ ...base, status: 'asleep' }).ok).toBe(false);
    expect(parse({ ...base, endsAt: NOW + PROTOCOL.endsAtAheadMs + 1 }).ok).toBe(false); // too far ahead
    expect(parse({ ...base, endsAt: NOW - PROTOCOL.endsAtBehindMs - 1 }).ok).toBe(false);
    expect(parse({ ...base, endsAt: null }).ok).toBe(false); // focusing needs an end
    expect(parse({ ...base, status: 'idle' }).ok).toBe(false); // idle has none
    expect(parse({ ...base, todayMin: 2000 }).ok).toBe(false);
    expect(parse({ ...base, rounds: 1.5 }).ok).toBe(false);
    expect(parse({ ...base, endsAt: 'soon' }).ok).toBe(false);
  });
  it('shortens a long subject', () => {
    const r = parse({ type: 'presence', status: 'idle', endsAt: null, subject: 'S'.repeat(80), todayMin: 0, rounds: 0 });
    expect(r.msg.subject.length).toBeLessThanOrEqual(PROTOCOL.subjectMax);
  });
  it('accepts cheers and leaving; refuses unknown, oversized and broken messages', () => {
    expect(parse({ type: 'cheer', to: ID })).toEqual({ ok: true, msg: { type: 'cheer', to: ID } });
    expect(parse({ type: 'cheer', to: 'x' }).ok).toBe(false);
    expect(parse({ type: 'leave' }).ok).toBe(true);
    expect(parse({ type: 'chat', text: 'hi' }).error).toBe('unknown-type');
    expect(parse(JSON.stringify({ type: 'hello', id: ID, name: 'x'.repeat(2000) })).error).toBe('too-big');
    expect(parse('{nope').error).toBe('not-json');
    expect(parse('null').error).toBe('not-json');
    expect(parseClientMessage(new ArrayBuffer(4), NOW).error).toBe('not-text');
  });
});

describe('rateLimit', () => {
  it('allows a burst of 20, then refills 2 a second', () => {
    let b = null;
    for (let i = 0; i < 20; i++) {
      const r = rateLimit(b, NOW);
      expect(r.ok).toBe(true);
      b = r.bucket;
    }
    expect(rateLimit(b, NOW).ok).toBe(false);
    expect(rateLimit(b, NOW + 500).ok).toBe(true); // one token back after half a second
  });
});

describe('publicMember', () => {
  it('shares only the public fields', () => {
    const m = { id: ID, name: 'Asha', status: 'idle', endsAt: null, subject: null, todayMin: 0, rounds: 0, secret: 1 };
    expect(publicMember(m)).not.toHaveProperty('secret');
  });
});
