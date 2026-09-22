/**
 * Move focus to the element a selector names once React has committed the render that adds
 * or reveals it. For the moments an editor or dialog closes and the control that opened it
 * is back on the page: without this, focus falls to the document and a keyboard user starts
 * from the top.
 */
export function focusAfterRender(selector: string) {
  requestAnimationFrame(() => requestAnimationFrame(() => document.querySelector<HTMLElement>(selector)?.focus()));
}
