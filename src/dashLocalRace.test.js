import { describe, it, expect } from 'vitest';
import { createLocalDashBackend, LOCAL_RACE_CODE, LOCAL_PLAYER_UID } from './dashLocalRace.js';
import { isRaceOver } from './dashLogic.js';

const settings = { trackLength: 5, wrongStepBack: 2, botCount: 2, botSkill: 'medium', questionSet: 'fractions', allowedOps: ['+'] };
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function newRace(overrides = {}){
  const backend = createLocalDashBackend({ now: () => 1234 });
  await backend.createRace('Ana', { ...settings, ...overrides });
  const seen = [];
  backend.listenToRace(LOCAL_RACE_CODE, (race) => seen.push(race));
  await tick();
  return { backend, seen, latest: () => seen[seen.length - 1] };
}

describe('createRace', () => {
  it('puts the host and the requested bots in a waiting lobby', async () => {
    const { latest } = await newRace();
    const race = latest();
    expect(race.status).toBe('waiting');
    expect(race.hostUid).toBe(LOCAL_PLAYER_UID);
    expect(Object.keys(race.players)).toEqual([LOCAL_PLAYER_UID, 'bot1', 'bot2']);
    expect(race.players.bot1.isBot).toBe(true);
    expect(race.settings.trackLength).toBe(5);
  });

  it('caps bots at nine', async () => {
    const { latest } = await newRace({ botCount: 50 });
    expect(Object.keys(latest().players)).toHaveLength(10);
  });
});

describe('startRace', () => {
  it('goes active and stamps startedAt from the injected clock', async () => {
    const { backend, latest } = await newRace();
    await backend.startRace(LOCAL_RACE_CODE);
    await tick();
    expect(latest().status).toBe('active');
    expect(latest().startedAt).toBe(1234);
  });
});

describe('progress and finishing', () => {
  it('records a racer\'s progress', async () => {
    const { backend, latest } = await newRace();
    await backend.startRace(LOCAL_RACE_CODE);
    await backend.reportProgress(LOCAL_RACE_CODE, 'bot1', { position: 3, correctCount: 3, wrongCount: 0 });
    await tick();
    expect(latest().players.bot1).toMatchObject({ position: 3, correctCount: 3, wrongCount: 0 });
  });

  it('gives the win to the first finisher only, and ends the race', async () => {
    const { backend, latest } = await newRace();
    await backend.startRace(LOCAL_RACE_CODE);
    const botWon = await backend.finishRace(LOCAL_RACE_CODE, 'bot1', { position: 5, correctCount: 5, wrongCount: 0 });
    const meWon = await backend.finishRace(LOCAL_RACE_CODE, LOCAL_PLAYER_UID, { position: 5, correctCount: 6, wrongCount: 1 });
    await tick();
    expect(botWon).toBe(true);
    expect(meWon).toBe(false);
    const race = latest();
    expect(race.winnerUid).toBe('bot1');
    expect(race.players[LOCAL_PLAYER_UID].finished).toBe(true);
    expect(isRaceOver(race)).toBe(true);
  });

  it('ignores writes for racers or codes that do not exist', async () => {
    const { backend, latest } = await newRace();
    await backend.reportProgress(LOCAL_RACE_CODE, 'nobody', { position: 1, correctCount: 1, wrongCount: 0 });
    await backend.reportProgress('WRONG', 'bot1', { position: 4, correctCount: 4, wrongCount: 0 });
    await tick();
    expect(latest().players.nobody).toBeUndefined();
    expect(latest().players.bot1.position).toBe(0);
  });
});

describe('listeners', () => {
  it('hand out copies, so mutating a snapshot cannot change the race', async () => {
    const { backend, latest } = await newRace();
    latest().players.bot1.position = 99;
    await backend.reportProgress(LOCAL_RACE_CODE, 'bot2', { position: 1, correctCount: 1, wrongCount: 0 });
    await tick();
    expect(latest().players.bot1.position).toBe(0);
  });

  it('stop receiving updates after unsubscribing', async () => {
    const { backend } = await newRace();
    const calls = [];
    const unsub = backend.listenToRace(LOCAL_RACE_CODE, (race) => calls.push(race));
    await tick();
    const before = calls.length;
    unsub();
    await backend.startRace(LOCAL_RACE_CODE);
    await tick();
    expect(calls).toHaveLength(before);
  });
});

describe('leaving', () => {
  it('deletes the race and tells listeners it is gone', async () => {
    const { backend, latest } = await newRace();
    await backend.leaveRace(LOCAL_RACE_CODE, LOCAL_PLAYER_UID, { isHost: true, status: 'waiting', raceOver: false });
    await tick();
    expect(latest()).toBeNull();
  });
});
