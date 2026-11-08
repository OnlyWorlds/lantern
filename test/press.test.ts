// The press guard: a redraw driven by data waits while a press is down, and at the click the
// click's own redraw runs at once while the held ones run on the next turn.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Press = typeof import('../src/press');

let win: EventTarget & { setTimeout: typeof setTimeout };

async function fresh(): Promise<Press> {
  vi.resetModules();
  win = Object.assign(new EventTarget(), { setTimeout: ((fn: () => void, ms?: number) => setTimeout(fn, ms)) as typeof setTimeout });
  vi.stubGlobal('window', win);
  const p = await import('../src/press');
  p.watchPresses();
  return p;
}

const fire = (type: string) => win.dispatchEvent(new Event(type));

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('press guard', () => {
  it('runs a redraw at once when no press is down', async () => {
    const p = await fresh();
    const fn = vi.fn();
    p.afterPress(fn);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('holds a redraw through the press and runs it on the turn after the click', async () => {
    const p = await fresh();
    fire('pointerdown');
    const held = vi.fn();
    p.afterPress(held);
    fire('pointerup');
    fire('click');
    expect(held).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(held).toHaveBeenCalledTimes(1);
  });

  it("runs the click's own redraw at once, inside the click", async () => {
    const p = await fresh();
    const own = vi.fn();
    // A handler registered after the guard's capture listener, as every app handler is.
    win.addEventListener('click', () => p.afterPress(own));
    fire('pointerdown');
    fire('pointerup');
    fire('click');
    expect(own).toHaveBeenCalledTimes(1);
    expect(p.pressHeld()).toBe(false);
  });

  it('keeps running the held redraws when one throws', async () => {
    const p = await fresh();
    fire('pointerdown');
    const first = vi.fn(() => { throw new Error('boom'); });
    const second = vi.fn();
    p.afterPress(first);
    p.afterPress(second);
    fire('pointercancel');
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    // The throw is put back on its own turn, so it still reaches the console.
    expect(() => vi.advanceTimersByTime(0)).toThrow('boom');
  });

  it('frees a press that never becomes a click, 300 ms after the lift', async () => {
    const p = await fresh();
    fire('pointerdown');
    const held = vi.fn();
    p.afterPress(held);
    fire('pointerup');
    vi.advanceTimersByTime(299);
    expect(held).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(held).toHaveBeenCalledTimes(1);
  });

  it('frees a press whose lift never comes, 5 s after the pointerdown', async () => {
    const p = await fresh();
    fire('pointerdown');
    const held = vi.fn();
    p.afterPress(held);
    vi.advanceTimersByTime(4999);
    expect(held).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(held).toHaveBeenCalledTimes(1);
  });

  it('leaves the held redraws to a new press that began before their turn', async () => {
    const p = await fresh();
    fire('pointerdown');
    const held = vi.fn();
    p.afterPress(held);
    fire('click');
    fire('pointerdown'); // a second finger before the next turn
    vi.advanceTimersByTime(0);
    expect(held).not.toHaveBeenCalled();
    fire('pointercancel');
    expect(held).toHaveBeenCalledTimes(1);
  });
});
