export default function StatusPill({ children }) {
  return <span className={`status status-${String(children).toLowerCase().replace(' ', '-')}`}>{children}</span>
}
