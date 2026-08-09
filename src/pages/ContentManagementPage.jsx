import { AlertTriangle, Check, Eye, FileText, Home, Info, MessageSquareQuote, Plus, Save, Sparkles, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import AppShell from '../components/AppShell'
import { describeError } from '../utils/describeError'
import {
  CONTENT_DEFAULTS, deleteTestimonial, fetchContentMenuOptions, fetchPortalConfiguration,
  fetchTestimonials, savePortalConfiguration, saveTestimonial,
} from '../services/adminPortalConfigurationService'

const SECTIONS = [
  ['hero', 'Homepage', Home, 'Hero and first impression'],
  ['featured', 'Featured menu', Sparkles, 'Bestseller selection'],
  ['inquiry', 'Inquiry & About', MessageSquareQuote, 'Pre-orders and story'],
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

  return <AppShell role="admin" title="Content Management" eyebrow="Control the customer-facing story without changing menu or order data." onRefresh={() => setRefreshSignal((value) => value + 1)}>
    <section className="ac-workspace">
      <header className="ac-overview">
        <div><span className="ac-overview-icon"><FileText size={21}/></span><div><h2>Storefront content</h2><p>Update each area independently, then preview the customer homepage.</p></div></div>
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
                <Field label="Small heading" wide><input value={content.hero.eyebrow} onChange={(event) => update('hero', { eyebrow: event.target.value })} maxLength={80}/></Field>
                <Field label="Main headline" wide hint={`${content.hero.title.length}/110 characters`}><textarea rows="2" value={content.hero.title} onChange={(event) => update('hero', { title: event.target.value })} maxLength={110}/></Field>
                <Field label="Supporting message" wide><textarea rows="4" value={content.hero.body} onChange={(event) => update('hero', { body: event.target.value })} maxLength={360}/></Field>
                <Field label="Primary button label"><input value={content.hero.primaryLabel} onChange={(event) => update('hero', { primaryLabel: event.target.value })}/></Field>
                <Field label="Primary destination"><input value={content.hero.primaryHref} onChange={(event) => update('hero', { primaryHref: event.target.value })}/></Field>
                <Field label="Secondary link label"><input value={content.hero.secondaryLabel} onChange={(event) => update('hero', { secondaryLabel: event.target.value })}/></Field>
                <Field label="Secondary destination"><input value={content.hero.secondaryHref} onChange={(event) => update('hero', { secondaryHref: event.target.value })}/></Field>
              </div>
            </EditorSection>}

            {section === 'featured' && <EditorSection title="Featured menu" description="Choose up to six active menu items. Product details continue to come from Manage Menu." onSave={() => saveSection('featured')} saving={saving}>
              <div className="ac-form-grid">
                <Field label="Section label"><input value={content.featured.eyebrow} onChange={(event) => update('featured', { eyebrow: event.target.value })}/></Field>
                <Field label="Section title"><input value={content.featured.title} onChange={(event) => update('featured', { title: event.target.value })}/></Field>
                <Toggle checked={content.featured.visible} onChange={(value) => update('featured', { visible: value })} label="Show this section on the homepage"/>
              </div>
              <div className="ac-choice-heading"><div><b>Menu selection</b><span>{selectedMenu.size} of 6 selected</span></div></div>
              <div className="ac-menu-picker">{menu.map((item) => <button type="button" key={item.id} className={selectedMenu.has(String(item.id)) ? 'is-selected' : ''} onClick={() => toggleFeatured(item.id)} disabled={!selectedMenu.has(String(item.id)) && selectedMenu.size >= 6}>
                <span className="ac-menu-thumb">{item.image_url ? <img src={item.image_url.startsWith('/') || /^https?:\/\//i.test(item.image_url) ? item.image_url : `/${item.image_url}`} alt=""/> : <Sparkles size={18}/>}</span>
                <span><b>{item.name}</b><small>{item.category} · PHP {Number(item.price).toFixed(0)}</small></span><i>{selectedMenu.has(String(item.id)) && <Check size={15}/>}</i>
              </button>)}</div>
            </EditorSection>}

            {section === 'inquiry' && <EditorSection title="Inquiry & About" description="Keep pre-order guidance and the café story clear and current." onSave={async () => { setSaving(true); try { await Promise.all([savePortalConfiguration('content', 'inquiry', content.inquiry, true), savePortalConfiguration('content', 'about', content.about, true)]); setNotice('Inquiry and About content published.'); setSetupRequired(false) } catch (cause) { setError(describeError(cause, 'The content could not be published.')) } finally { setSaving(false) } }} saving={saving}>
              <div className="ac-subsection"><h3>Customer inquiry</h3><div className="ac-form-grid">
                <Field label="Small heading"><input value={content.inquiry.kicker} onChange={(event) => update('inquiry', { kicker: event.target.value })}/></Field>
                <Field label="Main heading"><input value={content.inquiry.title} onChange={(event) => update('inquiry', { title: event.target.value })}/></Field>
                <Field label="Response promise"><input value={content.inquiry.responseTitle} onChange={(event) => update('inquiry', { responseTitle: event.target.value })}/></Field>
                <Field label="Response detail"><input value={content.inquiry.responseBody} onChange={(event) => update('inquiry', { responseBody: event.target.value })}/></Field>
                <Toggle checked={content.inquiry.visible} onChange={(value) => update('inquiry', { visible: value })} label="Show customer inquiry section"/>
              </div></div>
              <div className="ac-subsection"><h3>About the café</h3><div className="ac-form-grid">
                <Field label="Small heading"><input value={content.about.eyebrow} onChange={(event) => update('about', { eyebrow: event.target.value })}/></Field>
                <Field label="Story headline"><input value={content.about.title} onChange={(event) => update('about', { title: event.target.value })}/></Field>
                <Field label="First paragraph" wide><textarea rows="4" value={content.about.paragraphs?.[0] || ''} onChange={(event) => update('about', { paragraphs: [event.target.value, content.about.paragraphs?.[1] || ''] })}/></Field>
                <Field label="Second paragraph" wide><textarea rows="4" value={content.about.paragraphs?.[1] || ''} onChange={(event) => update('about', { paragraphs: [content.about.paragraphs?.[0] || '', event.target.value] })}/></Field>
              </div></div>
            </EditorSection>}

            {section === 'reviews' && <section className="ac-editor-section"><header><div><h2>Testimonials</h2><p>Publish short, attributable customer quotes. Keep each one easy to scan.</p></div><button className="ac-primary-button" type="button" onClick={() => setReviewDraft({ ...EMPTY_REVIEW, display_order: testimonials.length })}><Plus size={16}/>Add testimonial</button></header>
              <div className="ac-review-list">{testimonials.length ? testimonials.map((review) => <article key={review.id}><div className="ac-review-rating">{'★'.repeat(review.rating || 5)}</div><blockquote>“{review.quote}”</blockquote><div><span><b>{review.name}</b><small>{review.label || 'Customer'} · {review.visible ? 'Published' : 'Hidden'}</small></span><span><button type="button" onClick={() => setReviewDraft({ ...review })}>Edit</button><button type="button" className="is-danger" onClick={() => removeReview(review)} disabled={String(review.id).startsWith('default-')} title={String(review.id).startsWith('default-') ? 'Publish this default testimonial before removing it' : undefined}><Trash2 size={15}/></button></span></div></article>) : <EmptyContent title="No testimonials yet" message="Add a customer quote when you have permission to publish it."/>}</div>
            </section>}

            {section === 'footer' && <EditorSection title="Footer & Social" description="Contact details come from System Settings; these links shape the storefront footer." onSave={() => saveSection('footer')} saving={saving}>
              <div className="ac-form-grid">
                <Field label="Footer tagline" wide><input value={content.footer.tagline} onChange={(event) => update('footer', { tagline: event.target.value })}/></Field>
                <Field label="Facebook URL"><input type="url" value={content.footer.facebookUrl} onChange={(event) => update('footer', { facebookUrl: event.target.value })}/></Field>
                <Field label="Instagram URL"><input type="url" value={content.footer.instagramUrl} onChange={(event) => update('footer', { instagramUrl: event.target.value })}/></Field>
                <Field label="TikTok URL"><input type="url" value={content.footer.tiktokUrl} onChange={(event) => update('footer', { tiktokUrl: event.target.value })}/></Field>
              </div>
            </EditorSection>}
          </>}
        </main>
      </div>
    </section>
    {reviewDraft && <div className="ac-modal-backdrop" onMouseDown={() => !saving && setReviewDraft(null)}><form className="ac-modal" onSubmit={saveReview} onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="review-editor-title"><header><div><h2 id="review-editor-title">{reviewDraft.id ? 'Edit testimonial' : 'Add testimonial'}</h2><p>Only publish quotes you have permission to use.</p></div></header><div className="ac-form-grid">
      <Field label="Customer name"><input autoFocus required maxLength={80} value={reviewDraft.name} onChange={(event) => setReviewDraft({ ...reviewDraft, name: event.target.value })}/></Field>
      <Field label="Label"><input maxLength={80} value={reviewDraft.label} onChange={(event) => setReviewDraft({ ...reviewDraft, label: event.target.value })}/></Field>
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
function Toggle({ checked, onChange, label }) { return <label className="ac-toggle-row"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}/><span aria-hidden="true"><i/></span><b>{label}</b></label> }
function ContentSkeleton() { return <div className="ac-skeleton" aria-label="Loading content editor"><i/><i/><i/><i/></div> }
function EmptyContent({ title, message }) { return <div className="ac-empty"><MessageSquareQuote size={24}/><b>{title}</b><span>{message}</span></div> }
