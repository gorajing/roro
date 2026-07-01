import { afterEach, describe, expect, it, vi } from 'vitest';
import { __test, getPetWindow, registerPetWindow } from './windowRegistry';

type Handler = () => void;

function fakeWindow(options: { destroyed?: boolean } = {}) {
  const handlers = new Map<string, Handler[]>();
  return {
    isDestroyed: () => Boolean(options.destroyed),
    on: vi.fn((event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    }),
    emit(event: string): void {
      for (const h of handlers.get(event) ?? []) h();
    },
  };
}

const asWindow = (w: ReturnType<typeof fakeWindow>) => w as unknown as Parameters<typeof registerPetWindow>[0];

describe('windowRegistry — the named pet-window target', () => {
  afterEach(() => __test.reset());

  it('returns null before any registration', () => {
    expect(getPetWindow()).toBeNull();
  });

  it('returns the registered pet window', () => {
    const pet = fakeWindow();
    registerPetWindow(asWindow(pet));
    expect(getPetWindow()).toBe(pet);
  });

  it('self-clears when the pet window closes', () => {
    const pet = fakeWindow();
    registerPetWindow(asWindow(pet));
    pet.emit('closed');
    expect(getPetWindow()).toBeNull();
  });

  it('returns null for a destroyed-but-not-closed window (never a dead target)', () => {
    const pet = fakeWindow({ destroyed: true });
    registerPetWindow(asWindow(pet));
    expect(getPetWindow()).toBeNull();
  });

  it("an old window's late close does not clear a newer registration (activate re-create)", () => {
    const first = fakeWindow();
    const second = fakeWindow();
    registerPetWindow(asWindow(first));
    registerPetWindow(asWindow(second));
    first.emit('closed'); // the old window's closed handler fires after replacement
    expect(getPetWindow()).toBe(second);
  });
});
