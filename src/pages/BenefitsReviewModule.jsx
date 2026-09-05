import { useCallback, useEffect, useRef, useState } from 'react'
import { BadgeCheck, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { BENEFIT_STATUS, benefitKind, fetchBenefitApplications, reviewBenefitApplication } from '../services/benefitsService'
import BenefitDocument from '../components/BenefitDocument'
import '../benefits.css'

export default function BenefitsReviewModule({ refreshSignal }) {
  const [status, setStatus] = useState('pending')
  const [page, setPage] = useState(1)
  const [result, setResult] = useState({ items: [], count: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const load = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    fetchBenefitApplications(status, page).then(data => {
      if (!active) return
      const pages = Math.max(1, Math.ceil(data.count / 10))
      if (page > pages) setPage(pages)
      else setResult(data)
    }).catch(cause => { if (active) setError(cause.message || 'Could not load applications.') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [page, status, revision, refreshSignal])
  const pages = Math.max(1, Math.ceil(result.count / 10))
  return <section className="ua-module benefit-admin">
    <header className="ua-module-intro"><div><span className="ua-module-icon"><BadgeCheck size={20}/></span><div><h2>Benefits verification</h2><p>Review Senior Citizen and PWD applications.</p></div></div></header>
    <div className="benefit-status-navigation">
      <nav className="benefit-status-tabs" aria-label="Application status">
        {['pending', 'approved', 'resubmission', 'rejected', 'all'].map(value => <button key={value} type="button" aria-current={status === value ? 'page' : undefined} onClick={() => { setStatus(value); setPage(1); setSelected(null); setNotice('') }}>{value === 'all' ? 'All applications' : BENEFIT_STATUS[value]}</button>)}
      </nav>
      <span className="benefit-status-count" aria-live="polite">{loading ? 'Loading…' : error ? 'Count unavailable' : `${result.count} ${result.count === 1 ? 'application' : 'applications'}`}</span>
    </div>
    {notice && <p className="benefit-admin-notice" role="status">{notice}</p>}
    {error ? <div className="benefit-error" role="alert"><p>{error}</p><button className="ua-secondary-action" onClick={load}>Try again</button></div> : loading ? <p className="benefit-admin-notice" role="status">Loading applications…</p> : <>
      <div className="benefit-table-wrap"><table className="ua-table"><thead><tr><th>Applicant</th><th>Benefit</th><th>Submitted</th><th>Status</th><th>Action</th></tr></thead><tbody>{result.items.map(item => <tr key={item.id}><td><b>{item.full_name}</b><small>Submission {item.revision}</small></td><td>{benefitKind(item.kind)}</td><td>{new Date(item.submitted_at).toLocaleDateString('en-PH')}</td><td><span className={`benefit-badge is-${item.status}`}>{BENEFIT_STATUS[item.status]}</span></td><td><button className="ua-row-action" onClick={() => setSelected(item)}>{item.status === 'pending' ? 'Review' : 'View details'}</button></td></tr>)}</tbody></table></div>
      {!result.items.length && <div className="ua-empty"><BadgeCheck size={28}/><b>No applications found</b><span>Customer applications will appear here after submission.</span></div>}
      <footer className="ua-pagination"><span>{result.count ? `${(page - 1) * 10 + 1}–${Math.min(page * 10, result.count)} of ${result.count}` : '0 applications'} · Page {page} of {pages}</span><div><button aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(value => value - 1)}><ChevronLeft/></button><button aria-label="Next page" disabled={page >= pages} onClick={() => setPage(value => value + 1)}><ChevronRight/></button></div></footer>
    </>}
    {selected && <ApplicationReview key={`${selected.id}-${selected.revision}`} application={selected} onClose={() => setSelected(null)} onDecision={value => { setSelected(null); setNotice(`Application for ${value.full_name}: ${BENEFIT_STATUS[value.status].toLowerCase()}.`); load() }} />}
  </section>
}

function ApplicationReview({ application, onClose, onDecision }) {
  const [decision, setDecision] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialogRef = useRef(null)
  const reasonRef = useRef(null)
  useEffect(() => {
    const dialog = dialogRef.current
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.showModal()
    return () => { dialog.close(); document.body.style.overflow = previousOverflow }
  }, [])
  const needsReason = decision === 'rejected' || decision === 'resubmission'
  const actions = [
    ['approved', 'Approve'],
    ['rejected', 'Reject'],
    ['resubmission', 'Request resubmission'],
  ]
  const selectDecision = value => {
    setDecision(value); setError('')
    if (value !== 'approved') requestAnimationFrame(() => reasonRef.current?.focus())
  }
  const submit = async event => {
    event.preventDefault()
    if (busy || !decision) return
    if (needsReason && note.trim().length < 5) { setError('Enter a reason with at least 5 characters.'); reasonRef.current?.focus(); return }
    setBusy(true); setError('')
    try { onDecision(await reviewBenefitApplication(application, decision, needsReason ? note : '')) }
    catch (cause) { setError(cause.message || 'The decision could not be saved.') }
    finally { setBusy(false) }
  }
  return <dialog ref={dialogRef} className="benefit-review-drawer" aria-labelledby="benefit-review-title"
    onCancel={event => { event.preventDefault(); if (!busy) onClose() }}
    onClick={event => { if (event.target === event.currentTarget && event.clientX < event.currentTarget.getBoundingClientRect().left && !busy) onClose() }}>
    <header className="benefit-drawer-header"><div><span className="benefit-drawer-kicker">Benefits verification</span><h2 id="benefit-review-title">{application.full_name}</h2><p>{benefitKind(application.kind)}</p></div><button type="button" className="ua-secondary-action" aria-label="Close application details" onClick={onClose} disabled={busy} autoFocus><X size={20}/></button></header>
    <div className="benefit-drawer-body">
      <span className={`benefit-badge is-${application.status}`}>{BENEFIT_STATUS[application.status]}</span>
      <section><h3>Applicant details</h3><dl className="benefit-details"><div><dt>Full name</dt><dd>{application.full_name}</dd></div><div><dt>Date of birth</dt><dd>{application.date_of_birth}</dd></div><div><dt>ID number</dt><dd>{application.id_number}</dd></div><div><dt>Submitted</dt><dd>{new Date(application.submitted_at).toLocaleString('en-PH')}</dd></div></dl></section>
      <section><h3>Submitted ID photo</h3><BenefitDocument path={application.document_path}/></section>
      {application.review_note && <div className="benefit-review-note"><b>Reviewer message</b><p>{application.review_note}</p></div>}
      {application.status === 'pending' && <form id="benefit-review-decision" onSubmit={submit} className="benefit-drawer-decision">
        <h3>Review decision</h3><p>Choose how to proceed with this application.</p>
        <div className="benefit-decision-options" role="group" aria-label="Review decision">{actions.map(([value, label]) => <button type="button" key={value} className={`benefit-decision-option is-${value}`} aria-pressed={decision === value} onClick={() => selectDecision(value)} disabled={busy}>{label}</button>)}</div>
        {needsReason && <label className="benefit-reason"><span>{decision === 'rejected' ? 'Reason for rejection' : 'What needs to be corrected?'} <b>(required)</b></span><textarea ref={reasonRef} required minLength={5} maxLength={1000} rows={4} value={note} onChange={event => setNote(event.target.value)} disabled={busy} placeholder={decision === 'rejected' ? 'Explain why this application cannot be approved.' : 'Tell the customer which details or ID photo to update.'} aria-describedby="benefit-reason-hint"/><small id="benefit-reason-hint">This explanation will be shown to the customer. {note.length}/1,000</small></label>}
        {decision === 'approved' && <p className="benefit-approval-hint">Confirm that the applicant details match the submitted ID. No reason is required for approval.</p>}
        {error && <p className="benefit-error" role="alert">{error}</p>}
      </form>}
    </div>
    <footer className="benefit-drawer-footer"><button type="button" className="ua-secondary-action" onClick={onClose} disabled={busy}>Close</button>{application.status === 'pending' && <button type="submit" form="benefit-review-decision" className={decision === 'rejected' ? 'ua-danger-action' : 'ua-primary-action'} disabled={busy || !decision || (needsReason && note.trim().length < 5)}>{busy ? 'Saving decision…' : decision === 'approved' ? 'Confirm approval' : decision === 'rejected' ? 'Confirm rejection' : decision === 'resubmission' ? 'Send resubmission request' : 'Choose a decision'}</button>}</footer>
  </dialog>
}
