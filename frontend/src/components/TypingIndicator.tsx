export default function TypingIndicator() {
  return (
    <div className="flex items-start px-3 pb-3">
      <div
        className="flex items-center gap-1 px-3 py-3"
        style={{ background: "#E9E9EB", borderRadius: "18px 18px 18px 4px" }}
      >
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block h-2 w-2 rounded-full bg-gray-500"
            style={{
              animation: "typing-bounce 1.2s infinite",
              animationDelay: `${i * 0.18}s`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
