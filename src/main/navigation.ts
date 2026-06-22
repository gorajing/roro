// src/main/navigation.ts — the renderer-navigation allowlist (security).
//
// The renderer holds the full window.companion/brain/memory/vision bridge (incl. runTask, which
// dispatches a workspace-write coding agent). If a navigation or window.open swapped the document
// to an attacker origin, that origin would INHERIT the bridge. So the window denies all new-window
// opens and only permits navigation to the app's OWN document. This pure predicate is the policy.
export function isSafeNavigation(targetUrl: string, appUrl: string): boolean {
  let target: URL;
  let app: URL;
  try {
    target = new URL(targetUrl);
    app = new URL(appUrl);
  } catch {
    return false; // unparseable target (e.g. "javascript:"/garbage) -> never allow
  }
  if (app.protocol === 'file:') {
    // Packaged: allow only file:// navigations under the app's own directory (reload / hash routes).
    if (target.protocol !== 'file:') return false;
    const appDir = app.pathname.replace(/[^/]*$/, ''); // strip the file name -> the directory
    return target.pathname.startsWith(appDir);
  }
  // Dev server (http/https): same origin only.
  return target.origin === app.origin;
}
