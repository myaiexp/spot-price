// Minimal document-like double for renderer copy tests (no jsdom).

export type FakeEl = {
  innerHTML: string;
  textContent: string;
  style: Record<string, string>;
  value: string;
  className: string;
  children: FakeEl[];
  appendChild: (child: FakeEl) => FakeEl;
  addEventListener: (...args: unknown[]) => void;
  // Recorded by the default addEventListener so tests can fire a handler
  // (e.g. a heatmap cell's mouseenter) without a real event loop.
  listeners: Record<string, ((event?: unknown) => void)[]>;
  dispatch: (type: string, event?: unknown) => void;
};

export function fakeEl(init: Partial<FakeEl> = {}): FakeEl {
  const el: FakeEl = {
    innerHTML: '',
    textContent: '',
    style: {},
    value: '',
    className: '',
    children: [],
    listeners: {},
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(type, fn) {
      (this.listeners[type as string] ??= []).push(fn as (event?: unknown) => void);
    },
    dispatch(type, event) {
      for (const fn of this.listeners[type] ?? []) fn(event);
    },
    ...init,
  };
  return el;
}

export function fakeDocument(elements: Record<string, FakeEl>) {
  return {
    getElementById(id: string): FakeEl | null {
      return elements[id] ?? null;
    },
    createElement(_tag: string): FakeEl {
      return fakeEl();
    },
  };
}
