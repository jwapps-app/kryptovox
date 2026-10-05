import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

// Step-up confirmation: security-factor changes (turning off two-factor,
// adding a passkey, replacing the recovery key, …) take the current password
// so a session that was left open or stolen can't weaken the account on its
// own. usePasswordPrompt() returns an `ask()` that resolves with the password
// (or null on cancel) plus the element to render.

export function usePasswordPrompt(): {
  ask: (title: string, detail?: string) => Promise<string | null>;
  element: ReactNode;
} {
  const [state, setState] = useState<{ title: string; detail?: string } | null>(null);
  const resolver = useRef<((v: string | null) => void) | null>(null);

  const ask = useCallback((title: string, detail?: string) => {
    return new Promise<string | null>((resolve) => {
      resolver.current?.(null); // a newer prompt supersedes an unanswered one
      resolver.current = resolve;
      setState({ title, detail });
    });
  }, []);

  const finish = useCallback((value: string | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setState(null);
  }, []);

  const element = state ? (
    <PasswordPrompt title={state.title} detail={state.detail} onSubmit={finish} />
  ) : null;
  return { ask, element };
}

function PasswordPrompt({
  title,
  detail,
  onSubmit,
}: {
  title: string;
  detail?: string;
  onSubmit: (password: string | null) => void;
}) {
  const [password, setPassword] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const previouslyFocused = useRef<Element | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onSubmit(null);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      (previouslyFocused.current as HTMLElement | null)?.focus?.();
    };
  }, [onSubmit]);

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-black/40 px-4 pb-6 sm:items-center"
      onClick={() => onSubmit(null)}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="pw-prompt-title"
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          if (password) onSubmit(password);
        }}
      >
        <h2 id="pw-prompt-title" className="text-base font-semibold">
          {title}
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          {detail ?? "Confirm your password to continue."}
        </p>
        <label className="mt-3 block">
          <span className="sr-only">Current password</span>
          <input
            ref={inputRef}
            type="password"
            autoComplete="current-password"
            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-[17px] outline-none focus:border-imsg-blue"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => onSubmit(null)}
            className="flex-1 rounded-xl border border-gray-200 py-2.5 text-gray-600 active:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!password}
            className="flex-1 rounded-xl bg-imsg-blue py-2.5 font-medium text-white active:opacity-70 disabled:opacity-50"
          >
            Continue
          </button>
        </div>
      </form>
    </div>
  );
}
