import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCircle2, ChevronLeft, ChevronRight, CircleHelp, Inbox, Mail,
  MessageCircleQuestion, Reply, Search, Send, ShoppingBag, X,
} from 'lucide-react'
import AppShell from '../components/AppShell'
import { describeError } from '../utils/describeError'
import { fetchCustomerMessages, replyToCustomerMessage } from '../services/customerMessageService'

const FILTERS = [
  ['all', 'All'],
  ['pre_order', 'Pre-orders'],
  ['general_inquiry', 'General inquiries'],
  ['help_request', 'Help requests'],
]
const TYPE_META = {
  pre_order: { label: 'Pre-order', icon: ShoppingBag },
  general_inquiry: { label: 'General inquiry', icon: MessageCircleQuestion },
  help_request: { label: 'Help request', icon: CircleHelp },
}
const PAGE_SIZES = [10, 25, 50]

function formatDate(value) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-PH', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(new Date(value))
}

function isToday(value) {
  if (!value) return false
  const options = { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }
  const formatter = new Intl.DateTimeFormat('en-CA', options)
  return formatter.format(new Date(value)) === formatter.format(new Date())
}

function messageSearchText(message) {
  return [message.customer_name, message.customer_email, message.customer_phone, message.subject,
    message.message, message.inquiry_type, message.quantity].filter(Boolean).join(' ').toLowerCase()
}

export default function CustomerMessagesPage() {
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [filter, setFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [selected, setSelected] = useState(null)
  const [toast, setToast] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      setMessages(await fetchCustomerMessages())
      setError('')
    } catch (cause) {
      setError(describeError(cause, 'Customer messages could not be loaded.'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])
  useEffect(() => { setPage(1) }, [deferredQuery, filter, pageSize])
  useEffect(() => {
    if (!toast) return undefined
    const timer = window.setTimeout(() => setToast(''), 4200)
    return () => window.clearTimeout(timer)
  }, [toast])

  const counts = useMemo(() => ({
    all: messages.length,
    pre_order: messages.filter((item) => item.category === 'pre_order').length,
    general_inquiry: messages.filter((item) => item.category === 'general_inquiry').length,
    help_request: messages.filter((item) => item.category === 'help_request').length,
  }), [messages])

  const filtered = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase()
    return messages.filter((message) => {
      const categoryMatches = filter === 'all' || message.category === filter
      return categoryMatches && (!needle || messageSearchText(message).includes(needle))
    })
  }, [deferredQuery, filter, messages])

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageRows = filtered.slice((safePage - 1) * pageSize, safePage * pageSize)
  const awaitingReply = messages.filter((item) => item.status !== 'replied').length
  const replied = messages.filter((item) => item.status === 'replied').length
  const receivedToday = messages.filter((item) => isToday(item.created_at)).length

  const handleReplySent = (updated) => {
    setMessages((current) => current.map((item) => item.id === updated.id ? updated : item))
    setSelected(null)
    setToast(`Reply sent to ${updated.customer_email}.`)
  }

  return <AppShell role="staff" title="Customer Messages" eyebrow="Customer care inbox" onRefresh={load}>
    <section className="cm-page" aria-busy={loading}>
      <div className="cm-summary-grid" aria-label="Message summary">
        <SummaryCard icon={Inbox} label="Total messages" value={messages.length} detail="Across all customer channels" tone="green" />
        <SummaryCard icon={Mail} label="Awaiting reply" value={awaitingReply} detail="Messages needing attention" tone="amber" />
        <SummaryCard icon={CheckCircle2} label="Replied" value={replied} detail="Responses successfully emailed" tone="blue" />
        <SummaryCard icon={MessageCircleQuestion} label="Received today" value={receivedToday} detail="New in Manila time" tone="rose" />
      </div>

      <section className="cm-inbox-card" aria-labelledby="customer-inbox-title">
        <header className="cm-inbox-heading">
          <div><span>Unified inbox</span><h2 id="customer-inbox-title">Customer requests</h2></div>
          <p>{awaitingReply} {awaitingReply === 1 ? 'message needs' : 'messages need'} a response</p>
        </header>

        <div className="cm-toolbar">
          <label className="cm-search">
            <Search size={18} aria-hidden="true" />
            <span className="sr-only">Search customer messages</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, subject, or message" />
            {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear message search"><X size={16} /></button>}
          </label>
          <div className="cm-filter-tabs" role="tablist" aria-label="Message type filters">
            {FILTERS.map(([value, label]) => <button
              key={value}
              type="button"
              role="tab"
              aria-selected={filter === value}
              className={filter === value ? 'active' : ''}
              onClick={() => setFilter(value)}
            ><span>{label}</span><b>{counts[value]}</b></button>)}
          </div>
        </div>

        {error && <div className="cm-state cm-state-error" role="alert"><b>Unable to load messages</b><span>{error}</span><button type="button" onClick={load}>Try again</button></div>}
        {!error && loading && <div className="cm-state" role="status">Loading customer messages…</div>}
        {!error && !loading && !pageRows.length && <div className="cm-state"><Inbox size={28} /><b>No messages found</b><span>Try another filter or clear the search.</span></div>}

        {!error && !loading && pageRows.length > 0 && <>
          <div className="cm-table-wrap">
            <table className="cm-table">
              <caption className="sr-only">Customer messages sorted newest first</caption>
              <thead><tr><th>Customer</th><th>Request type</th><th>Message</th><th>Received</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{pageRows.map((message) => <MessageRow key={message.id} message={message} onReply={() => setSelected(message)} />)}</tbody>
            </table>
          </div>
          <div className="cm-mobile-list">{pageRows.map((message) => <MessageCard key={message.id} message={message} onReply={() => setSelected(message)} />)}</div>
          <Pagination page={safePage} totalPages={totalPages} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={setPageSize} />
        </>}
      </section>
    </section>
    {selected && <ReplyDialog message={selected} onClose={() => setSelected(null)} onSent={handleReplySent} />}
    {toast && <div className="cm-toast" role="status"><CheckCircle2 size={18} />{toast}</div>}
  </AppShell>
}

function SummaryCard({ icon: Icon, label, value, detail, tone }) {
  return <article className={`cm-summary-card tone-${tone}`}><span><Icon size={20} /></span><div><b>{label}</b><small>{detail}</small></div><strong>{value}</strong></article>
}

function TypeBadge({ category }) {
  const meta = TYPE_META[category] || TYPE_META.general_inquiry
  const Icon = meta.icon
  return <span className={`cm-type-badge type-${category}`}><Icon size={14} />{meta.label}</span>
}

function StatusBadge({ status }) {
  const replied = status === 'replied'
  return <span className={`cm-status-badge ${replied ? 'is-replied' : 'is-new'}`}>{replied ? <CheckCircle2 size={13} /> : <span aria-hidden="true" />}{replied ? 'Replied' : 'Awaiting reply'}</span>
}

function MessageRow({ message, onReply }) {
  return <tr>
    <td><div className="cm-customer"><b>{message.customer_name}</b><a href={`mailto:${message.customer_email}`}>{message.customer_email}</a>{message.customer_phone && <small>{message.customer_phone}</small>}</div></td>
    <td><TypeBadge category={message.category} /></td>
    <td><div className="cm-message-preview"><b>{message.subject}</b><p>{message.message}</p>{message.preferred_date && <small>Preferred date: {new Intl.DateTimeFormat('en-PH', { dateStyle: 'medium' }).format(new Date(`${message.preferred_date}T00:00:00`))}</small>}</div></td>
    <td><time dateTime={message.created_at}>{formatDate(message.created_at)}</time></td>
    <td><StatusBadge status={message.status} /></td>
    <td><button className="cm-reply-button" type="button" onClick={onReply}><Reply size={16} />{message.status === 'replied' ? 'Reply again' : 'Reply'}</button></td>
  </tr>
}

function MessageCard({ message, onReply }) {
  return <article className="cm-message-card"><header><TypeBadge category={message.category} /><StatusBadge status={message.status} /></header><h3>{message.subject}</h3><p>{message.message}</p><div><b>{message.customer_name}</b><small>{message.customer_email}</small><time dateTime={message.created_at}>{formatDate(message.created_at)}</time></div><button className="cm-reply-button" type="button" onClick={onReply}><Reply size={16} />{message.status === 'replied' ? 'Reply again' : 'Reply'}</button></article>
}

function Pagination({ page, totalPages, pageSize, total, onPage, onPageSize }) {
  const first = total ? (page - 1) * pageSize + 1 : 0
  const last = Math.min(page * pageSize, total)
  return <footer className="cm-pagination">
    <span>Showing <b>{first}–{last}</b> of <b>{total}</b> messages</span>
    <label>Rows per page<select value={pageSize} onChange={(event) => onPageSize(Number(event.target.value))}>{PAGE_SIZES.map((size) => <option key={size}>{size}</option>)}</select></label>
    <div><button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Previous page"><ChevronLeft size={18} /></button><span>Page <b>{page}</b> of {totalPages}</span><button type="button" onClick={() => onPage(page + 1)} disabled={page >= totalPages} aria-label="Next page"><ChevronRight size={18} /></button></div>
  </footer>
}

function ReplyDialog({ message, onClose, onSent }) {
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef(null)
  useEffect(() => {
    const closeOnEscape = (event) => { if (event.key === 'Escape' && !sending) onClose() }
    document.addEventListener('keydown', closeOnEscape)
    dialogRef.current?.focus()
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose, sending])

  const submit = async (event) => {
    event.preventDefault()
    if (reply.trim().length < 2) return setError('Write a reply before sending.')
    setSending(true); setError('')
    try { onSent(await replyToCustomerMessage(message.id, reply.trim())) }
    catch (cause) { setError(describeError(cause, 'The reply could not be sent. Check the email configuration and try again.')); setSending(false) }
  }

  return <div className="cm-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !sending) onClose() }}>
    <section className="cm-dialog" role="dialog" aria-modal="true" aria-labelledby="cm-reply-title" tabIndex={-1} ref={dialogRef}>
      <header><div><span>Reply to customer</span><h2 id="cm-reply-title">{message.subject}</h2></div><button type="button" onClick={onClose} disabled={sending} aria-label="Close reply dialog"><X size={19} /></button></header>
      <div className="cm-dialog-recipient"><Mail size={18} /><span><b>{message.customer_name}</b><small>{message.customer_email}</small></span><TypeBadge category={message.category} /></div>
      <blockquote><p>{message.message}</p><footer>{formatDate(message.created_at)}</footer></blockquote>
      {message.reply_text && <div className="cm-previous-reply"><b>Previous reply</b><p>{message.reply_text}</p><small>Sent {formatDate(message.replied_at)}</small></div>}
      <form onSubmit={submit}>
        <label><span>Your reply</span><textarea autoFocus required minLength={2} maxLength={5000} value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Write a clear, helpful response…" /></label>
        <small>The customer will receive a branded email at {message.customer_email}.</small>
        {error && <p className="cm-dialog-error" role="alert">{error}</p>}
        <footer><button type="button" className="cm-secondary-button" onClick={onClose} disabled={sending}>Cancel</button><button type="submit" className="cm-send-button" disabled={sending || !reply.trim()}>{sending ? 'Sending…' : <><Send size={17} />Send reply</>}</button></footer>
      </form>
    </section>
  </div>
}
