// Generic exclusive toggle-group wiring: a click moves .active to the clicked
// button, then runs onSelect(btn).
export function wireToggleGroup(selector, onSelect) {
  const buttons = document.querySelectorAll(selector);
  buttons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      buttons.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      onSelect(btn);
    });
  });
}
