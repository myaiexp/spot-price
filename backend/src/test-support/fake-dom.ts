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
};

export function fakeEl(init: Partial<FakeEl> = {}): FakeEl {
  const el: FakeEl = {
    innerHTML: '',
    textContent: '',
    style: {},
    value: '',
    className: '',
    children: [],
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener() {},
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
