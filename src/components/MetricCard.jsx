export default function MetricCard({ label, value, detail, icon: Icon, tone = 'sage' }) {
  return (
    <article className={`metric-card metric-${tone}`}>
      <div className="metric-icon"><Icon size={20} /></div>
      <span>{label}</span><strong>{value}</strong><small>{detail}</small>
    </article>
  )
}
