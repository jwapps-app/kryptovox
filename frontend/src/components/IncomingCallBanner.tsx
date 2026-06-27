import { useNavigate } from "react-router-dom";
import { useCalls } from "../store/calls";

// Shown to the host when a secret-link guest is calling and the host isn't on
// that thread page (delivered over the main socket as a "doorbell"). Tapping
// Answer navigates to the thread, where the buffered offer drives the call UI.
export default function IncomingCallBanner() {
  const navigate = useNavigate();
  const linkRing = useCalls((s) => s.linkRing);
  const dismiss = useCalls((s) => s.dismissLinkRing);
  const status = useCalls((s) => s.status);

  if (!linkRing || status !== "idle") return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[90] flex justify-center px-3 pt-3">
      <div className="flex w-full max-w-md items-center gap-3 rounded-2xl bg-gray-900 px-4 py-3 text-white shadow-lg">
        <span className="text-xl">📞</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{linkRing.name} is calling</div>
          <div className="truncate text-xs text-white/60">on your secret link</div>
        </div>
        <button
          className="rounded-full bg-white/15 px-3 py-1.5 text-xs active:opacity-70"
          onClick={() => dismiss()}
        >
          Dismiss
        </button>
        <button
          className="rounded-full bg-green-500 px-4 py-1.5 text-sm font-medium active:opacity-70"
          onClick={() => {
            const id = linkRing.threadId;
            dismiss();
            navigate(`/links/${id}`);
          }}
        >
          Answer
        </button>
      </div>
    </div>
  );
}
