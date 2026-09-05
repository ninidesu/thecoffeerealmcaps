import { AlertTriangle, Check, CheckCircle2, ClipboardCheck, Eye, FileText, Home, Info, MessageSquareQuote, Plus, Save, Sparkles, Trash2, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import AppShell from '../components/AppShell'
import { describeError } from '../utils/describeError'
import { sanitizePersonName } from '../utils/inputValidation'
import { fetchMenuApprovalRequests, updateMenuApprovalRequest } from '../services/menuApprovalService'
import {
  CONTENT_DEFAULTS, deleteTestimonial, fetchContentMenuOptions, fetchPortalConfiguration,
  fetchTestimonials, savePortalConfiguration, saveTestimonial,
} from '../services/adminPortalConfigurationService'

const SECTIONS = [
  ['hero', 'Homepage', Home, 'Hero and first impression'],
  ['featured', 'Featured menu', Sparkles, 'Bestseller selection'],
  ['approvals', 'Menu approvals', ClipboardCheck, 'Review staff menu changes'],
  ['about', 'About', MessageSquareQuote, 'Café story'],
  ['reviews', 'Testimonials', MessageSquareQuote, 'Customer quotes'],
  ['footer', 'Footer & Social', Info, 'Contact and social links'],
]
const EMPTY_REVIEW = { name: '', label: 'Customer', quote: '', rating: 5, visible: true, display_order: 0 }

function formatUpdated(value) {
  if (!value) return 'Not published from this workspace yet'
  return `Updated ${new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(value))}`
}

function Field({ label, hint, wide = false, children }) {
  return <label className={`ac-field${wide ? ' ac-field--wide' : ''}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}

export default function ContentManagementPage() {
  const [section, setSection] = useState('hero')
  const [content, setContent] = useState(CONTENT_DEFAULTS)
  const [menu, setMenu] = useState([])
  const [testimonials, setTestimonials] = useState([])
  const [updatedAt, setUpdatedAt] = useState(null)
  const [setupRequired, setSetupRequired] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [reviewDraft, setReviewDraft] = useState(null)
  const [refreshSignal, setRefreshSignal] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [configuration, menuItems, reviews] = await Promise.all([
        fetchPortalConfiguration('content'), fetchContentMenuOptions(), fetchTestimonials(),
      ])
      setContent(configuration.values); setUpdatedAt(configuration.updatedAt); setSetupRequired(configuration.setupRequired)
      setMenu(menuItems); setTestimonials(reviews); setError('')
    } catch (cause) { setError(describeError(cause, 'Content settings could not be loaded.')) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load, refreshSignal])
  useEffect(() => { if (!notice) return undefined; const timer = window.setTimeout(() => setNotice(''), 3500); return () => window.clearTimeout(timer) }, [notice])

  const update = (key, values) => setContent((current) => ({ ...current, [key]: { ...current[key], ...values } }))
  const saveSection = async (key) => {
    setSaving(true); setError('')
    try {
      const saved = await savePortalConfiguration('content', key, content[key], true)
      setUpdatedAt(saved.updated_at); setSetupRequired(false); setNotice(`${SECTIONS.find(([id]) => id === key)?.[1] || 'Content'} published.`)
    } catch (cause) { setError(describeError(cause, 'This content could not be published.')) }
    finally { setSaving(false) }
  }
  const saveReview = async (event) => {
    event.preventDefault(); setSaving(true); setError('')
    try { await saveTestimonial(reviewDraft); setReviewDraft(null); await load(); setNotice('Testimonial saved.') }
    catch (cause) { setError(describeError(cause, 'The testimonial could not be saved.')) }
    finally { setSaving(false) }
  }
  const removeReview = async (review) => {
    if (!window.confirm(`Remove the testimonial from ${review.name}? This cannot be undone.`)) return
    setSaving(true)
    try { await deleteTestimonial(review.id); await load(); setNotice('Testimonial removed.') }
    catch (cause) { setError(describeError(cause, 'The testimonial could not be removed.')) }
    finally { setSaving(false) }
  }

  const selectedMenu = useMemo(() => new Set((content.featured.itemIds || []).map(String)), [content.featured.itemIds])
  const toggleFeatured = (id) => {
    const ids = [...(content.featured.itemIds || [])].map(String)
    const next = ids.includes(String(id)) ? ids.filter((value) => value !== String(id)) : ids.length < 6 ? [...ids, String(id)] : ids
    update('featured', { itemIds: next })
  }

  return <AppShell role="admin" title="Content Management" onRefresh={() => setRefreshSignal((value) => value + 1)}>
    <section className="ac-workspace">
      <header className="ac-overview">
        <div><span className="ac-overview-icon"><FileText size={21}/></span><div><h2>Storefront content</h2><p>Update each area independently, then publish when ready.</p></div></div>
        <div className="ac-overview-actions"><span><i className="ac-status-dot"/>{formatUpdated(updatedAt)}</span><a className="ac-secondary-button" href="/" target="_blank" rel="noreferrer"><Eye size={16}/>Preview homepage</a></div>
      </header>

      {setupRequired && <div className="ac-alert" role="status"><Info size={18}/><div><b>Database setup is still required</b><span>The editor is showing safe defaults. Apply the new portal configuration migration before publishing changes.</span></div></div>}
      {error && <div className="ac-alert ac-alert--error" role="alert"><AlertTriangle size={18}/><div><b>Something needs attention</b><span>{error}</span></div></div>}

      <div className="ac-layout">
        <nav className="ac-section-nav" aria-label="Content areas">
          {SECTIONS.map(([id, label, Icon, description]) => <button type="button" key={id} className={section === id ? 'is-active' : ''} onClick={() => setSection(id)} aria-current={section === id ? 'page' : undefined}><Icon size={18}/><span><b>{label}</b><small>{description}</small></span></button>)}
        </nav>

        <main className="ac-panel" aria-live="polite">
          {loading ? <ContentSkeleton/> : <>
            {section === 'hero' && <EditorSection title="Homepage hero" description="The first message customers see when they visit the storefront." onSave={() => saveSection('hero')} saving={saving}>
              <div className="ac-form-grid">
                <Field label="Small heading" wide><input value={content.hero.eyebrow} onChange={(event) => update('hero', { eyebrow: event.target.value })} maxLength={60}/></Field>
                <Field label="Main headline" wide hint={`${content.hero.title.length}/110 characters`}><textarea rows="2" value={content.hero.title} onChange={(event) => update('hero', { title: event.target.value })} maxLength={110}/></Field>
                <Field label="Supporting message" wide><textarea rows="4" value={content.hero.body} onChange={(event) => update('hero', { body: event.target.value })} maxLength={360}/></Field>
                <Field label="Primary button label"><input value={content.hero.primaryLabel} onChange={(event) => update('hero', { primaryLabel: event.target.value })} maxLength={32}/></Field>
                <Field label="Primary destination"><input value={content.hero.primaryHref} onChange={(event) => update('hero', { primaryHref: event.target.value })} maxLength={300}/></Field>
              </div>
            </EditorSection>}

            {section === 'featured' && <EditorSection title="Featured menu" description="Choose up to six active menu items. Product details continue to come from Manage Menu." onSave={() => saveSection('featured')} saving={saving}>
              <div className="ac-form-grid">
                <Field label="Section label"><input value={content.featured.eyebrow} onChange={(event) => update('featured', { eyebrow: event.target.value })} maxLength={60}/></Field>
                <Field label="Section title"><input value={content.featured.title} onChange={(event) => update('featured', { title: event.target.value })} maxLength={100}/></Field>
                <Toggle checked={content.featured.visible} onChange={(value) => update('featured', { visible: value })} label="Show this section on the homepage"/>
              </div>
              <div className="ac-choice-heading"><div><b>Menu selection</b><span>{selectedMenu.size} of 6 selected</span></div></div>
              <div className="ac-menu-picker">{menu.map((item) => <button type="button" key={item.id} className={selectedMenu.has(String(item.id)) ? 'is-selected' : ''} onClick={() => toggleFeatured(item.id)} disabled={!selectedMenu.has(String(item.id)) && selectedMenu.size >= 6}>
                <span className="ac-menu-thumb">{item.image_url ? <img src={item.image_url.startsWith('/') || /^https?:\/\//i.test(item.image_url) ? item.image_url : `/${item.image_url}`} alt=""/> : <Sparkles size={18}/>}</span>
                <span><b>{item.name}</b><small>{item.category} · PHP {Number(item.price).toFixed(0)} incl. VAT</small></span><i>{selectedMenu.has(String(item.id)) && <Check size={15}/>}</i>
              </button>)}</div>
            </EditorSection>}

            {section === 'about' && <EditorSection title="About the café" description="Keep the café story clear and current." onSave={() => saveSection('about')} saving={saving}>
              <div className="ac-subsection"><h3>About the café</h3><div className="ac-form-grid">
                 <Field label="Small heading"><input value={content.about.eyebrow} onChange={(event) => update('about', { eyebrow: event.target.value })} maxLength={60}/></Field>
                 <Field label="Story headline"><input value={content.about.title} onChange={(event) => update('about', { title: event.target.value })} maxLength={100}/></Field>
                 <Field label="First paragraph" wide><textarea rows="4" maxLength={500} value={content.about.paragraphs?.[0] || ''} onChange={(event) => update('about', { paragraphs: [event.target.value, content.about.paragraphs?.[1] || ''] })}/></Field>
                 <Field label="Second paragraph" wide><textarea rows="4" maxLength={500} value={content.about.paragraphs?.[1] || ''} onChange={(event) => update('about', { paragraphs: [content.about.paragraphs?.[0] || '', event.target.value] })}/></Field>
              </div></div>
            </EditorSection>}

            {section === 'approvals' && <MenuApprovalsQueue onAction={async (request, state) => { try { await updateMenuApprovalRequest(request.id, state); setNotice(`${request.itemName} marked ${state}.`) } catch (cause) { setError(describeError(cause, 'The approval decision could not be saved.')) } }} />}

            {section === 'reviews' && <section className="ac-editor-section"><header><div><h2>Testimonials</h2><p>Publish short, attributable customer quotes. Keep each one easy to scan.</p></div><button className="ac-primary-button" type="button" onClick={() => setReviewDraft({ ...EMPTY_REVIEW, display_order: testimonials.length })}><Plus size={16}/>Add testimonial</button></header>
              <div className="ac-review-list">{testimonials.length ? testimonials.map((review) => <article key={review.id}><div className="ac-review-rating">{'★'.repeat(review.rating || 5)}</div><blockquote>“{review.quote}”</blockquote><div><span><b>{review.name}</b><small>{review.label || 'Customer'} · {review.visible ? 'Published' : 'Hidden'}</small></span><span><button type="button" onClick={() => setReviewDraft({ ...review })}>Edit</button><button type="button" className="is-danger" onClick={() => removeReview(review)} disabled={String(review.id).startsWith('default-')} title={String(review.id).startsWith('default-') ? 'Publish this default testimonial before removing it' : undefined}><Trash2 size={15}/></button></span></div></article>) : <EmptyContent title="No testimonials yet" message="Add a customer quote when you have permission to publish it."/>}</div>
            </section>}

            {section === 'footer' && <EditorSection title="Footer & Social" description="Contact details come from System Settings; these links shape the storefront footer." onSave={() => saveSection('footer')} saving={saving}>
              <div className="ac-form-grid">
                 <Field label="Footer tagline" wide><input value={content.footer.tagline} onChange={(event) => update('footer', { tagline: event.target.value })} maxLength={120}/></Field>
                 <Field label="Facebook URL"><input type="url" maxLength={300} value={content.footer.facebookUrl} onChange={(event) => update('footer', { facebookUrl: event.target.value })}/></Field>
                 <Field label="Instagram URL"><input type="url" maxLength={300} value={content.footer.instagramUrl} onChange={(event) => update('footer', { instagramUrl: event.target.value })}/></Field>
                 <Field label="TikTok URL"><input type="url" maxLength={300} value={content.footer.tiktokUrl} onChange={(event) => update('footer', { tiktokUrl: event.target.value })}/></Field>
              </div>
            </EditorSection>}
          </>}
        </main>
      </div>
    </section>
    {reviewDraft && <div className="ac-modal-backdrop" onMouseDown={() => !saving && setReviewDraft(null)}><form className="ac-modal" onSubmit={saveReview} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="review-editor-title"><header><div><h2 id="review-editor-title">{reviewDraft.id ? 'Edit testimonial' : 'Add testimonial'}</h2><p>Only publish quotes you have permission to use.</p></div></header><div className="ac-form-grid">
       <Field label="Customer name"><input autoFocus required maxLength={60} value={reviewDraft.name} onChange={(event) => setReviewDraft({ ...reviewDraft, name: sanitizePersonName(event.target.value, 60) })}/></Field>
       <Field label="Label"><input maxLength={40} value={reviewDraft.label} onChange={(event) => setReviewDraft({ ...reviewDraft, label: event.target.value })}/></Field>
      <Field label="Quote" wide><textarea required rows="5" maxLength={420} value={reviewDraft.quote} onChange={(event) => setReviewDraft({ ...reviewDraft, quote: event.target.value })}/></Field>
      <Field label="Rating"><select value={reviewDraft.rating} onChange={(event) => setReviewDraft({ ...reviewDraft, rating: Number(event.target.value) })}>{[5,4,3,2,1].map((rating) => <option key={rating} value={rating}>{rating} stars</option>)}</select></Field>
      <Field label="Display order"><input type="number" min="0" value={reviewDraft.display_order} onChange={(event) => setReviewDraft({ ...reviewDraft, display_order: Number(event.target.value) })}/></Field>
      <Toggle checked={reviewDraft.visible} onChange={(value) => setReviewDraft({ ...reviewDraft, visible: value })} label="Publish on homepage"/>
    </div><footer><button type="button" className="ac-secondary-button" onClick={() => setReviewDraft(null)} disabled={saving}>Cancel</button><button className="ac-primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save testimonial'}</button></footer></form></div>}
    {notice && <div className="ac-toast" role="status"><Check size={17}/>{notice}</div>}
  </AppShell>
}

function EditorSection({ title, description, onSave, saving, children }) {
  return <section className="ac-editor-section"><header><div><h2>{title}</h2><p>{description}</p></div></header><div className="ac-editor-body">{children}</div><footer><span>Changes apply only after publishing.</span><button className="ac-primary-button" type="button" onClick={onSave} disabled={saving}><Save size={16}/>{saving ? 'Publishing…' : 'Publish changes'}</button></footer></section>
}

function matchesApprovalChangeType(item, filter) {
  if (filter === 'all') return true
  const types = (item.changeTypes || []).map((type) => String(type).toLowerCase())
  if (filter === 'updated') return item.action === 'change'
  if (filter === 'new') return item.action === 'add' && types.some((type) => type.includes('new'))
  if (filter === 'ready') return types.some((type) => type.includes('ready') || type.includes('item type'))
  const terms = {
    price: ['price'], image: ['image'], description: ['description'], addons: ['add-on'], choices: ['choice'],
    ingredients: ['ingredient'], category: ['categor'], temperature: ['temperature'], display: ['display'], discount: ['discount eligibility'],
  }
  return (terms[filter] || []).some((term) => types.some((type) => type.includes(term)))
}

function MenuApprovalsQueue({ onAction }) {
  const [status, setStatus] = useState('pending')
  const [changeType, setChangeType] = useState('all')
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)
  const [requests, setRequests] = useState([])
  useEffect(() => {
    const refresh = async () => { try { setRequests(await fetchMenuApprovalRequests()) } catch { setRequests([]) } }
    refresh()
    const interval = window.setInterval(refresh, 15000)
    window.addEventListener('storage', refresh)
    window.addEventListener('menu-approval-requests-changed', refresh)
    return () => { window.clearInterval(interval); window.removeEventListener('storage', refresh); window.removeEventListener('menu-approval-requests-changed', refresh) }
  }, [])
  const rows = requests.filter((item) => (status === 'all' || item.state === status) && matchesApprovalChangeType(item, changeType))
  const sortedRows = [...rows].sort((a, b) => sort === 'oldest' ? new Date(a.createdAt) - new Date(b.createdAt) : new Date(b.createdAt) - new Date(a.createdAt))
  const pageSize = 8
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize))
  const visibleRows = sortedRows.slice((page - 1) * pageSize, page * pageSize)
  const counts = {
    pending: requests.filter((item) => item.state === 'pending').length,
    approved: requests.filter((item) => item.state === 'approved').length,
    rejected: requests.filter((item) => item.state === 'rejected').length,
  }

  return <section className="ac-approval-section" aria-labelledby="menu-approvals-title">
    <header className="ac-approval-header"><div><span className="ac-approval-icon"><ClipboardCheck size={21}/></span><div><h2 id="menu-approvals-title">Menu change approvals</h2><p>Review menu updates submitted by staff before they appear on the customer storefront.</p></div></div></header>
    <div className="ac-approval-controls">
      <div className="ac-approval-tabs" role="tablist" aria-label="Menu approval status">
        {[['pending', 'Pending approval', counts.pending], ['approved', 'Approved', counts.approved], ['rejected', 'Rejected', counts.rejected]].map(([key, label, count]) => <button key={key} type="button" role="tab" aria-selected={status === key} className={status === key ? 'is-active' : ''} onClick={() => { setStatus(key); setPage(1) }}>{label}<b>{count}</b></button>)}
      </div>
      <div className="ac-approval-toolbar"><label><span>Change type</span><select value={changeType} onChange={(event) => { setChangeType(event.target.value); setPage(1) }}><option value="all">All change types</option><option value="price">Price update</option><option value="new">New item</option><option value="updated">Updated</option><option value="image">Image update</option><option value="description">Description update</option><option value="addons">Add-ons updated</option><option value="choices">Choices updated</option><option value="ingredients">Ingredients updated</option><option value="ready">Ready-made item</option><option value="category">Category update</option><option value="temperature">Temperature update</option><option value="display">Display settings</option><option value="discount">SC/PWD discount eligibility</option></select></label><label><span>Sort</span><select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1) }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label></div>
    </div>
    <div className="ac-approval-table-wrap"><table className="ac-approval-table"><thead><tr><th>Menu item</th><th>Change type</th><th>Changed by</th><th>Date</th><th>Details</th><th>Actions</th></tr></thead><tbody>{visibleRows.map((item) => <tr key={item.id}>
      <td><div className="ac-approval-item"><span><b>{item.itemName}</b><small>Staff menu change</small><em>{item.action}</em></span></div></td>
      <td><span className="ac-change-badge ac-change-badge--updated">{item.changeTypes.join(', ')}</span></td>
      <td><span className="ac-approval-person"><i>ST</i><span><b>Staff member</b><small>Staff</small></span></span></td>
      <td><span className="ac-approval-date">{new Date(item.createdAt).toLocaleDateString()}<small>{new Date(item.createdAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></span></td>
      <td><span className="ac-approval-detail">{item.summary}<small>Awaiting admin decision</small></span></td>
      <td><div className="ac-approval-actions"><button type="button" className="ac-approval-reject" onClick={() => onAction(item, 'rejected')}><XCircle size={14}/>Reject</button><button type="button" className="ac-approval-approve" onClick={() => onAction(item, 'approved')}><CheckCircle2 size={14}/>Approve</button></div></td>
    </tr>)}</tbody></table></div>
    <div className="ac-approval-cards">{visibleRows.map((item) => <article className="ac-approval-card" key={item.id}><div className="ac-approval-card-top"><div className="ac-approval-item"><img src={item.image} alt=""/><span><b>{item.itemName}</b><small>Staff menu change</small></span></div><span className="ac-change-badge ac-change-badge--updated">{item.action}</span></div><div className="ac-approval-card-grid"><span><small>Submitted</small><b>{new Date(item.createdAt).toLocaleString()}</b></span><span><small>Change types</small><b>{item.changeTypes.join(', ')}</b></span><span><small>Details</small><b>{item.summary}</b></span></div><div className="ac-approval-actions"><button type="button" className="ac-approval-reject" onClick={() => onAction(item, 'rejected')}><XCircle size={14}/>Reject</button><button type="button" className="ac-approval-approve" onClick={() => onAction(item, 'approved')}><CheckCircle2 size={14}/>Approve</button></div></article>)}</div>
    {!sortedRows.length && <div className="ac-approval-empty"><ClipboardCheck size={24}/><b>No {status} changes</b><span>Staff submissions will appear here when an approval request is created.</span></div>}
    <footer className="ac-approval-footer"><span>Showing {sortedRows.length ? ((page - 1) * pageSize) + 1 : 0}–{Math.min(page * pageSize, sortedRows.length)} of {sortedRows.length} requests</span><div className="ac-pagination" aria-label="Approval request pages"><button type="button" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>‹</button><b>Page {page} of {totalPages}</b><button type="button" aria-label="Next page" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}>›</button></div></footer>
  </section>
}
function Toggle({ checked, onChange, label }) { return <label className="ac-toggle-row"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}/><span aria-hidden="true"><i/></span><b>{label}</b></label> }
function ContentSkeleton() { return <div className="ac-skeleton" aria-label="Loading content editor"><i/><i/><i/><i/></div> }
function EmptyContent({ title, message }) { return <div className="ac-empty"><MessageSquareQuote size={24}/><b>{title}</b><span>{message}</span></div> }
