// Exclusive toggle groups: setActive rewrites a group's .active, and
// wireToggleGroup moves it to the clicked button, then runs onSelect(btn).

// .active on every button the predicate accepts, cleared on the rest. The one
// place a group's .active is rewritten, so a click (wireToggleGroup) and a
// programmatic fallback (renderTomorrowTab) cannot drift apart.
export function setActive(buttons, predicate) {
  buttons.forEach((b) => b.classList.toggle('active', Boolean(predicate(b))));
}

export function wireToggleGroup(selector, onSelect) {
  const buttons = document.querySelectorAll(selector);
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      setActive(buttons, (b) => b === btn);
      onSelect(btn);
    });
  });
}
