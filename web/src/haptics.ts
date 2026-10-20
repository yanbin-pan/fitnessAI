/**
 * A light tap of the phone's haptics (2026-10-20), for the companion's peek. Android has navigator.vibrate. iOS Safari
 * has no web haptics API, but since iOS 18 it plays the system tick when a switch-style checkbox is toggled, so a
 * hidden one is toggled through its label. Best effort: elsewhere nothing happens.
 */
let label: HTMLLabelElement | null = null;

export function tapHaptic(): void {
  if (typeof navigator.vibrate === "function") {
    navigator.vibrate(10);
    return;
  }
  if (!label) {
    label = document.createElement("label");
    label.setAttribute("aria-hidden", "true");
    label.style.cssText = "position:fixed;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;left:-100px;top:0";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
  }
  label.click();
}
