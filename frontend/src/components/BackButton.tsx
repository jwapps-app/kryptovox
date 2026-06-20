interface Props {
  onClick: () => void;
  label?: string;
}

// iOS-style back chevron (thin, rounded, blue), optionally with a destination
// label like the system navigation bar.
export default function BackButton({ onClick, label }: Props) {
  return (
    <button
      onClick={onClick}
      aria-label="Back"
      className="-ml-1 flex items-center text-imsg-blue active:opacity-60"
    >
      <svg
        width="30"
        height="30"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M15 19l-7-7 7-7" />
      </svg>
      {label && <span className="-ml-0.5 text-[17px]">{label}</span>}
    </button>
  );
}
