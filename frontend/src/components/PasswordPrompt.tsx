import { useCallback, useRef, useState, type ReactNode } from "react";
import { authCredential } from "../store/auth";
import { useDialog } from "../hooks/useDialog";

// Step-up confirmation: security-factor changes (turning off two-factor,
// adding a passkey, replacing the recovery key, …) take the current password
// so a session that was left open or stolen can't weaken the account on its
// own. usePasswordPrompt() returns an `ask()` that resolves with the
// credential to send — the derived auth secret, never the raw password for an
// upgraded account — or null on cancel, plus the element to render.

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
    const resolve = resolver.current;
    resolver.current = null;
    setState(null);
    if (!resolve) return;
    if (value === null) resolve(null);
    else authCredential(value).then(resolve, () => resolve(null));
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
  const formRef = useRef<HTMLFormElement>(null);
  const cancel = useCallback(() => onSubmit(null), [onSubmit]);
  useDialog(formRef, cancel);

  return (
    <div
      className="fixed inset-0 z-110 flex items-end justify-center bg-black/40 px-4 pb-6 sm:items-center"
      onClick={() => onSubmit(null)}
    >
      <form
        ref={formRef}
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
            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 text-[17px] outline-hidden focus:border-imsg-blue"
            aria-label="Password"
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
