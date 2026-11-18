// Ledger explorer placeholder. The route exists now so /ledger never 404s;
// 9-04 replaces this module's contents without touching the router.

export const title = 'Ledger';
export const phase = 9;

export function render(root, doc = globalThis.document) {
  root.replaceChildren();
  const heading = doc.createElement('h1');
  heading.textContent = title;
  const notice = doc.createElement('p');
  notice.className = 'notice';
  notice.textContent = 'Delivered in Phase 9: Ledger. The windowed event ledger is the next unit in this phase.';
  root.append(heading, notice);
  return root;
}
