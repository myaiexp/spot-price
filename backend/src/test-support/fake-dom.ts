// Document-like double for renderer tests: elements, classList, buttons (no jsdom).

export type FakeClassList = {
  add: (token: string) => void;
  remove: (token: string) => void;
  contains: (token: string) => boolean;
  // True when the token is present after the call, matching DOMTokenList.toggle.
  toggle: (token: string, force?: boolean) => boolean;
};

export type FakeEl = {
  innerHTML: string;
  textContent: string;
  style: Record<string, string>;
  value: string;
  className: string;
  classList: FakeClassList;
  children: FakeEl[];
  appendChild: (child: FakeEl) => FakeEl;
  addEventListener: (...args: unknown[]) => void;
  // Recorded by the default addEventListener so tests can fire a handler
  // (e.g. a heatmap cell's mouseenter) without a real event loop.
  listeners: Record<string, ((event?: unknown) => void)[]>;
  dispatch: (type: string, event?: unknown) => void;
};

export type FakeButton = FakeEl & {
  disabled: boolean;
  dataset: Record<string, string>;
  title: string;
  id?: string;
  click: () => void;
};

function splitClassName(value: string): string[] {
  return value.split(/\s+/).filter((token) => token !== '');
}

// One token set, so className and classList cannot drift. Estimator chips set
// className = 'device-chip' and then classList.add('active'); heatmap cells
// are selected by an exact className string.
function bindClassList(classes: Set<string>): FakeClassList {
  return {
    add(token) {
      classes.add(token);
    },
    remove(token) {
      classes.delete(token);
    },
    contains(token) {
      return classes.has(token);
    },
    toggle(token, force) {
      // Omitted force, including explicit undefined (Web IDL treats that as
      // omitted), flips. A boolean force adds or removes. `if (force)` is
      // wrong: a missing force would remove the class.
      const on = force === undefined ? !classes.has(token) : force;
      if (on) classes.add(token);
      else classes.delete(token);
      return classes.has(token);
    },
  };
}

export function fakeClassList(initial: string[] = []): FakeClassList {
  return bindClassList(new Set(initial.filter((token) => token !== '')));
}

function attachClassName(el: object, classes: Set<string>): void {
  Object.defineProperty(el, 'className', {
    enumerable: true,
    configurable: true,
    get(): string {
      return [...classes].join(' ');
    },
    set(value: string) {
      classes.clear();
      for (const token of splitClassName(value)) classes.add(token);
    },
  });
}

export function fakeEl(init: Partial<FakeEl> = {}): FakeEl {
  const classes = new Set(splitClassName(init.className ?? ''));
  const classList = bindClassList(classes);
  const rest: Partial<FakeEl> = { ...init };
  delete rest.className;
  delete rest.classList;
  const el: FakeEl = {
    innerHTML: '',
    textContent: '',
    style: {},
    value: '',
    className: '',
    classList,
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
    ...rest,
  };
  // A spread init can replace classList. The name and the list share `classes`.
  el.classList = classList;
  attachClassName(el, classes);
  return el;
}

export function fakeButton({
  disabled = false,
  active = false,
  dataset = {},
  id,
}: {
  disabled?: boolean;
  active?: boolean;
  dataset?: Record<string, string>;
  id?: string;
} = {}): FakeButton {
  const el = fakeEl({ className: active ? 'active' : '' }) as FakeButton;
  el.disabled = disabled;
  el.dataset = dataset;
  el.title = '';
  if (id !== undefined) el.id = id;
  el.click = () => {
    el.dispatch('click');
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
