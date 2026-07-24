import { Coffee } from 'lucide-react'

export default function Brand({ light = false }) {
  return (
    <a className={`brand ${light ? 'brand-light' : ''}`} href="/" aria-label="The Coffee Realm home">
      <span className="brand-mark"><Coffee size={20} strokeWidth={1.8} /></span>
      <span>the coffee realm</span>
    </a>
  )
}
