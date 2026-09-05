import { useId, useRef, useState } from 'react'
import { CalendarDays } from 'lucide-react'

const displayDate = value => value ? `${value.slice(5,7)}/${value.slice(8,10)}/${value.slice(0,4)}` : ''

export default function BenefitBirthDateField({ value, onChange, max }) {
  const id = useId()
  const picker = useRef(null)
  const [text, setText] = useState(() => displayDate(value))
  const [fallback, setFallback] = useState(false)
  const typeDate = event => {
    const digits = event.target.value.replace(/[^0-9]/g, '').slice(0,8)
    const next = [digits.slice(0,2), digits.slice(2,4), digits.slice(4,8)].filter(Boolean).join('/')
    setText(next)
    const match = next.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
    onChange(match ? `${match[3]}-${match[1]}-${match[2]}` : '')
  }
  const openCalendar = () => {
    try {
      if (!picker.current?.showPicker) { setFallback(true); return }
      picker.current.showPicker()
    } catch { setFallback(true) }
  }
  return <div className="field benefit-birth-date">
    <label htmlFor={id}>Date of birth *</label>
    <div className="benefit-date-entry"><input id={id} type="text" required placeholder="MM/DD/YYYY" inputMode="numeric" maxLength={10} pattern="[0-9]{2}/[0-9]{2}/[0-9]{4}" title="Enter the date as MM/DD/YYYY." autoComplete="bday" aria-describedby={`${id}-hint`} value={text} onChange={typeDate}/><button type="button" onClick={openCalendar} aria-label="Choose date of birth from calendar"><CalendarDays size={20}/></button>
      <input ref={picker} className={fallback ? 'benefit-native-date is-visible' : 'benefit-native-date'} type="date" min="1900-01-01" max={max} value={value >= '1900-01-01' && value <= max ? value : ''} tabIndex={fallback ? 0 : -1} aria-label="Birth date calendar" onChange={event => { onChange(event.target.value); setText(displayDate(event.target.value)); setFallback(false) }}/>
    </div>
    <small id={`${id}-hint`}>Type MM/DD/YYYY or use the calendar.</small>
  </div>
}
