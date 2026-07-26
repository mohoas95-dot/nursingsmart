/**
 * scroll-restore — ابزار ثبت و بازگردانی موقعیت اسکرول
 *
 * کاربرد: وقتی کاربر از پنجره هشدارها روی «رفتن به سلول» می‌زند، وضعیت اسکرول
 * صفحه (و همه ظرف‌های اسکرول‌شونده والد سلول) ثبت می‌شود؛ سپس اگر هشدار با
 * ویرایش دستی برطرف شد، دقیقاً به همان موقعیت قبلی بازمی‌گردیم.
 */

export interface ScrollContainerSnapshot {
  element: HTMLElement;
  left: number;
  top: number;
}

export interface ScrollSnapshot {
  windowX: number;
  windowY: number;
  containers: ScrollContainerSnapshot[];
}

function isScrollable(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  const overflowY = style.overflowY;
  const overflowX = style.overflowX;
  const canScrollY =
    (overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
    el.scrollHeight > el.clientHeight + 1;
  const canScrollX =
    (overflowX === 'auto' || overflowX === 'scroll' || overflowX === 'overlay') &&
    el.scrollWidth > el.clientWidth + 1;
  return canScrollY || canScrollX;
}

/**
 * ثبت موقعیت فعلی اسکرول پنجره و ظرف‌های اسکرول‌شونده‌ی والدِ عنصر هدف.
 * اگر عنصری داده نشود، فقط اسکرول پنجره ثبت می‌شود.
 */
export function captureScrollSnapshot(target?: HTMLElement | null): ScrollSnapshot {
  if (typeof window === 'undefined') {
    return { windowX: 0, windowY: 0, containers: [] };
  }

  const containers: ScrollContainerSnapshot[] = [];
  let node: HTMLElement | null = target?.parentElement ?? null;

  while (node && node !== document.body && node !== document.documentElement) {
    if (isScrollable(node)) {
      containers.push({ element: node, left: node.scrollLeft, top: node.scrollTop });
    }
    node = node.parentElement;
  }

  return {
    windowX: window.scrollX ?? window.pageXOffset ?? 0,
    windowY: window.scrollY ?? window.pageYOffset ?? 0,
    containers,
  };
}

/** بازگردانی موقعیت اسکرول ثبت‌شده */
export function restoreScrollSnapshot(
  snapshot: ScrollSnapshot | null | undefined,
  options: { behavior?: ScrollBehavior } = {}
): void {
  if (!snapshot || typeof window === 'undefined') return;
  const behavior = options.behavior ?? 'smooth';

  snapshot.containers.forEach(({ element, left, top }) => {
    if (!element.isConnected) return;
    try {
      element.scrollTo({ left, top, behavior });
    } catch {
      element.scrollLeft = left;
      element.scrollTop = top;
    }
  });

  try {
    window.scrollTo({ left: snapshot.windowX, top: snapshot.windowY, behavior });
  } catch {
    window.scrollTo(snapshot.windowX, snapshot.windowY);
  }
}
