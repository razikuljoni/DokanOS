/**
 * Prints a receipt DOM element using a hidden iframe so window.print()
 * never blocks or freezes the main application tab.
 */
export function printReceiptElement(
  element: HTMLElement | null,
  title = 'DokanOS Thermal Receipt',
): { ok: boolean; reason?: string } {
  if (!element || typeof document === 'undefined') {
    return { ok: false, reason: 'Receipt content is not ready.' };
  }

  let iframe: HTMLIFrameElement | null = null;
  try {
    iframe = document.createElement('iframe');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    iframe.style.visibility = 'hidden';
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument ?? iframe.contentWindow?.document;
    const win = iframe.contentWindow;
    if (!doc || !win) {
      iframe.remove();
      return { ok: false, reason: 'Browser blocked print frame. Receipt remains visible on screen.' };
    }

    doc.open();
    doc.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      @page { margin: 4mm; }
      body {
        margin: 0;
        padding: 8px;
        font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        color: #111827;
        background: #ffffff;
        font-size: 12px;
        line-height: 1.4;
      }
      table { width: 100%; border-collapse: collapse; }
      th, td { padding: 2px 0; }
      .text-right { text-align: right; }
      .text-center { text-align: center; }
      .font-bold, strong { font-weight: 700; }
      .border-t { border-top: 1px dashed #9ca3af; }
      .border-b { border-bottom: 1px dashed #9ca3af; }
    </style>
  </head>
  <body>${element.innerHTML}</body>
</html>`);
    doc.close();

    const cleanup = (): void => {
      window.setTimeout(() => {
        iframe?.remove();
      }, 500);
    };

    win.onafterprint = cleanup;
    win.focus();
    win.print();
    window.setTimeout(cleanup, 2000);
    return { ok: true };
  } catch {
    iframe?.remove();
    return { ok: false, reason: 'Printing was blocked. Receipt remains visible on screen.' };
  }
}
