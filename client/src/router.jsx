import { useSyncExternalStore } from "react";

// A tiny history-based router: enough for three routes without a dependency.
const subscribe = (cb) => {
  addEventListener("popstate", cb);
  return () => removeEventListener("popstate", cb);
};

export function usePath() {
  return useSyncExternalStore(subscribe, () => location.pathname);
}

export function navigate(path, { replace = false } = {}) {
  if (path === location.pathname) return;
  history[replace ? "replaceState" : "pushState"](null, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
}

export function Link({ to, children, ...props }) {
  return (
    <a
      href={to}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
      {...props}
    >
      {children}
    </a>
  );
}
