import { JSDOM } from 'jsdom';

export function setupJsdom() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true
  });

  const { window } = dom;

  (global as any).window = window;
  (global as any).document = window.document;
  try {
    Object.defineProperty(global, 'navigator', {
      value: window.navigator,
      writable: true,
      configurable: true
    });
  } catch {}
  (global as any).HTMLElement = window.HTMLElement;
  (global as any).Element = window.Element;
  (global as any).Node = window.Node;
  (global as any).MouseEvent = window.MouseEvent;
  (global as any).KeyboardEvent = window.KeyboardEvent;
  (global as any).Event = window.Event;
  (global as any).IS_REACT_ACT_ENVIRONMENT = true;
  (global as any).requestAnimationFrame = (callback: FrameRequestCallback) => setTimeout(callback, 0);
  (global as any).cancelAnimationFrame = (id: number) => clearTimeout(id);

  return { dom, window, document: window.document };
}
