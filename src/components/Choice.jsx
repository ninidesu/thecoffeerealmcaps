import { money } from '../utils/money'

export default function Choice({ title, options, value, onChange }) {
  return (
    <fieldset className="choice-group">
      <legend>{title}</legend>
      <div>
        {options.map((o) => (
          <button type="button" className={value === o.id ? 'active' : ''} aria-pressed={value === o.id} onClick={() => onChange(o.id)} key={o.id}>
            {o.name}
            {Number(o.priceAdjustment) > 0 ? ` · ${money(o.price)}` : ''}
          </button>
        ))}
      </div>
    </fieldset>
  )
}
