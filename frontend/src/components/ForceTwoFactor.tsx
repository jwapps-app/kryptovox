import TwoFactorSetup from "./TwoFactorSetup";
import { useAuth } from "../store/auth";

// Full-screen mandatory enrollment when the admin requires 2FA and the user
// hasn't set it up. Can't be dismissed — only completed or signed out of.
export default function ForceTwoFactor({ onDone }: { onDone: () => void }) {
  const logout = useAuth((s) => s.logout);
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-gray-50 px-6"
      style={{ height: "var(--vh, 100dvh)" }}
    >
      <div className="w-full max-w-sm rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-center text-xl font-semibold">Two-factor required</h1>
        <p className="mb-5 text-center text-sm text-gray-500">
          Your administrator requires two-factor authentication. Set it up to continue.
        </p>
        <TwoFactorSetup onEnabled={onDone} />
        <button
          onClick={() => void logout()}
          className="mt-4 w-full text-center text-sm text-gray-400"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
