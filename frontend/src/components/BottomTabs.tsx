import { useLocation, useNavigate } from "react-router-dom";

// Bottom tab bar shown on the two top-level lists (Messages, Notes). Detail
// screens (a chat, a note) are pushed full-screen with a back button instead.
export default function BottomTabs() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const tab = (active: boolean) =>
    `flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[11px] ${
      active ? "text-imsg-blue" : "text-gray-400"
    } active:opacity-60`;

  return (
    <nav className="kv-input-bar flex border-t border-gray-100">
      <button className={tab(pathname === "/")} onClick={() => navigate("/")}>
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
        Messages
      </button>
      <button
        className={tab(pathname.startsWith("/notes"))}
        onClick={() => navigate("/notes")}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <line x1="10" y1="9" x2="8" y2="9" />
        </svg>
        Notes
      </button>
    </nav>
  );
}
