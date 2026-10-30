/**
 * Viewport-safe position calculator for Fast Entry QuickShiftPalette.
 *
 * Rules:
 * 1. Prefer opening to the RIGHT of the selected cell when space allows.
 * 2. If insufficient right-side space, FLIP to the LEFT of the selected cell.
 * 3. If neither side fully fits, clamp within viewport with a margin.
 * 4. Align vertically with cell top, shifting upward if bottom would overflow.
 * 5. Ensure coordinates never cause horizontal or vertical overflow.
 */
export function computePalettePosition({
  anchorRect,
  cellRect = anchorRect,
  popupWidth = 288,
  popupHeight = 260,
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1024,
  viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 768,
  scrollX = 0,
  scrollY = 0,
  margin = 8,
  gap = 8
} = {}) {
  const rect = cellRect || anchorRect;
  if (!rect) {
    return {
      top: `${Math.max(margin, Math.round((viewportHeight - popupHeight) / 2))}px`,
      left: `${Math.max(margin, Math.round((viewportWidth - popupWidth) / 2))}px`
    };
  }

  // 1. Horizontal calculation:
  // Prefer opening to the RIGHT of the selected cell
  const rightCandidate = rect.right + gap;
  const fitsRight = (rightCandidate + popupWidth + margin) <= viewportWidth;

  // Flip to the LEFT of the selected cell if insufficient right-side space
  const leftCandidate = rect.left - gap - popupWidth;
  const fitsLeft = leftCandidate >= margin;

  let left;
  if (fitsRight) {
    left = rightCandidate;
  } else if (fitsLeft) {
    left = leftCandidate;
  } else {
    // If neither side fully fits, clamp within viewport with margin
    const minLeft = margin;
    const maxLeft = Math.max(margin, viewportWidth - popupWidth - margin);
    left = Math.min(maxLeft, Math.max(minLeft, rect.left));
  }

  // 2. Vertical calculation:
  // Prefer aligning top with cell top
  let top = rect.top;
  const minTop = margin;
  const maxTop = Math.max(margin, viewportHeight - popupHeight - margin);

  // If overflowing bottom, adjust upwards
  if (top + popupHeight + margin > viewportHeight) {
    const bottomAligned = rect.bottom - popupHeight;
    if (bottomAligned >= minTop) {
      top = bottomAligned;
    } else {
      top = maxTop;
    }
  }

  // Ensure top stays strictly within [minTop, maxTop]
  top = Math.min(maxTop, Math.max(minTop, top));

  return {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`
  };
}
