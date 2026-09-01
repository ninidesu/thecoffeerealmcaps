import { AlertTriangle, Check, Clock3, CreditCard, Database, Image, Info, MapPin, Percent, RotateCcw, Save, ShieldCheck, ShoppingBag, Store, Upload } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import AppShell from '../components/AppShell'
import { describeError } from '../utils/describeError'
import { IMAGE_UPLOAD_ACCEPT, validateImageFile } from '../utils/imageUpload'
import {
  SYSTEM_DEFAULTS, fetchDeliveryZoneSettings, fetchPortalConfiguration,
  saveDeliveryZoneSettings, savePaymentConfiguration, savePortalConfiguration,
} from '../services/adminPortalConfigurationService'

const SECTIONS = [
  ['store', 'Store profile', Store, 'Public contact details'],
  ['ordering', 'Hours & ordering', Clock3, 'Availability and fulfillment'],
  ['delivery', 'Delivery zones', MapPin, 'Fees and estimates'],
  ['payments', 'Payments', CreditCard, 'Methods and instructions'],
  ['pricing', 'Pricing & VAT', Percent, 'Global price treatment'],
  ['security', 'Platform security', ShieldCheck, 'Access and safeguards'],
]

function Field({ label, hint, wide = false, children }) { return <label className={`ac-field${wide ? ' ac-field--wide' : ''}`}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label> }
function Toggle({ checked, onChange, label, hint }) { return <label className="ac-setting-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}/><span aria-hidden="true"><i/></span><span><b>{label}</b>{hint && <small>{hint}</small>}</span></label> }

export default function SystemSettingsPage() {
  const [section, setSection] = useState('store')
  const [settings, setSettings] = useState(SYSTEM_DEFAULTS)
  const [zones, setZones] = useState([])
  const [updatedAt, setUpdatedAt] = useState(null)
  const [setupRequired, setSetupRequired] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [qrFiles, setQrFiles] = useState({ gcash: null, bank_transfer: null })
  const [refreshSignal, setRefreshSignal] = useState(0)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [configuration, deliveryZones] = await Promise.all([fetchPortalConfiguration('system'), fetchDeliveryZoneSettings()])
      setSettings(configuration.values); setZones(deliveryZones); setUpdatedAt(configuration.updatedAt); setSetupRequired(configuration.setupRequired); setError('')
    } catch (cause) { setError(describeError(cause, 'System settings could not be loaded.')) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load, refreshSignal])
  useEffect(() => { if (!notice) return undefined; const timer = window.setTimeout(() => setNotice(''), 3500); return () => window.clearTimeout(timer) }, [notice])

  const update = (key, values) => setSettings((current) => ({ ...current, [key]: { ...current[key], ...values } }))
  const save = async (key) => {
    if (key === 'ordering' && !settings.ordering.deliveryEnabled && !settings.ordering.pickupEnabled) { setError('Keep at least one fulfillment method enabled.'); return }
    if (key === 'payments' && !(settings.payments.enabledMethods || []).length) { setError('Keep at least one payment method enabled.'); return }
    setSaving(true); setError('')
    try {
      if (key === 'delivery') await saveDeliveryZoneSettings(zones)
      else if (key === 'payments') {
        const result = await savePaymentConfiguration(settings.payments, qrFiles)
        setSettings((current) => ({ ...current, payments: result.settings })); setQrFiles({ gcash: null, bank_transfer: null }); setUpdatedAt(result.row.updated_at); setSetupRequired(false)
      } else { const row = await savePortalConfiguration('system', key, settings[key], key !== 'security'); setUpdatedAt(row.updated_at); setSetupRequired(false) }
      setNotice(`${SECTIONS.find(([id]) => id === key)?.[1] || 'Settings'} saved.`)
    } catch (cause) { setError(describeError(cause, 'These settings could not be saved.')) }
    finally { setSaving(false) }
  }
  const updateZone = (index, values) => setZones((current) => current.map((zone, zoneIndex) => zoneIndex === index ? { ...zone, ...values } : zone))
  const toggleMethod = (method) => {
    const methods = settings.payments.enabledMethods || []
    update('payments', { enabledMethods: methods.includes(method) ? methods.filter((value) => value !== method) : [...methods, method] })
  }

  const lastSaved = updatedAt ? new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(updatedAt)) : 'Defaults in use'
  return <AppShell role="admin" title="System Settings" onRefresh={() => setRefreshSignal((value) => value + 1)}>
    <section className="ac-workspace">
      <header className="ac-overview">
        <div><span className="ac-overview-icon"><Database size={21}/></span><div><h2>Operational configuration</h2><p>Settings are grouped by where they affect the customer and staff experience.</p></div></div>
        <div className="ac-overview-actions"><span><i className="ac-status-dot"/>Last saved: {lastSaved}</span></div>
      </header>
      {setupRequired && <div className="ac-alert" role="status"><Info size={18}/><div><b>Database setup is still required</b><span>The editor is showing safe defaults. Apply the portal configuration migration before saving settings.</span></div></div>}
      {error && <div className="ac-alert ac-alert--error" role="alert"><AlertTriangle size={18}/><div><b>Something needs attention</b><span>{error}</span></div></div>}
      <div className="ac-layout">
        <nav className="ac-section-nav" aria-label="System setting areas">{SECTIONS.map(([id, label, Icon, description]) => <button type="button" key={id} className={section === id ? 'is-active' : ''} onClick={() => setSection(id)} aria-current={section === id ? 'page' : undefined}><Icon size={18}/><span><b>{label}</b><small>{description}</small></span></button>)}</nav>
        <main className="ac-panel">
          {loading ? <div className="ac-skeleton"><i/><i/><i/><i/></div> : <>
            {section === 'store' && <SettingsSection title="Store profile" description="These details appear on customer-facing contact and footer surfaces." onSave={() => save('store')} saving={saving}>
              <div className="ac-form-grid">
                <Field label="Store name"><input value={settings.store.name} onChange={(event) => update('store', { name: event.target.value })}/></Field>
                <Field label="Business email"><input type="email" value={settings.store.email} onChange={(event) => update('store', { email: event.target.value })}/></Field>
                <Field label="Contact number"><input value={settings.store.phone} onChange={(event) => update('store', { phone: event.target.value })}/></Field>
                <Field label="Timezone" hint="Schedules and timestamps use this timezone."><select value={settings.store.timezone} onChange={(event) => update('store', { timezone: event.target.value })}><option value="Asia/Manila">Asia/Manila (PHT)</option></select></Field>
                <Field label="Store address" wide><textarea rows="3" value={settings.store.address} onChange={(event) => update('store', { address: event.target.value })}/></Field>
              </div>
            </SettingsSection>}

            {section === 'ordering' && <SettingsSection title="Hours & ordering" description="Control when customers can place orders and which fulfillment methods appear." onSave={() => save('ordering')} saving={saving}>
              <div className={`ac-store-state ${settings.ordering.storeStatus === 'open' ? 'is-open' : 'is-closed'}`}><span><i/><b>{settings.ordering.storeStatus === 'open' ? 'Accepting online orders' : 'Online ordering paused'}</b></span><select value={settings.ordering.storeStatus} onChange={(event) => update('ordering', { storeStatus: event.target.value })}><option value="open">Open</option><option value="closed">Closed</option></select></div>
              <div className="ac-form-grid">
                <Field label="Opening time"><input type="time" value={settings.ordering.openTime} onChange={(event) => update('ordering', { openTime: event.target.value })}/></Field>
                <Field label="Last order time"><input type="time" value={settings.ordering.closeTime} onChange={(event) => update('ordering', { closeTime: event.target.value })}/></Field>
                <Field label="Minimum order (PHP)" hint="Set to 0 for no minimum."><input type="number" min="0" step="1" value={settings.ordering.minimumOrder} onChange={(event) => update('ordering', { minimumOrder: Number(event.target.value) })}/></Field>
                <Field label="Closed-store message" wide><textarea rows="3" value={settings.ordering.closureMessage} onChange={(event) => update('ordering', { closureMessage: event.target.value })}/></Field>
              </div>
              <div className="ac-toggle-stack"><Toggle checked={settings.ordering.deliveryEnabled} onChange={(value) => update('ordering', { deliveryEnabled: value })} label="Delivery" hint="Show delivery as a checkout option."/><Toggle checked={settings.ordering.pickupEnabled} onChange={(value) => update('ordering', { pickupEnabled: value })} label="Store pickup" hint="Show pickup as a checkout option."/></div>
            </SettingsSection>}

            {section === 'delivery' && <SettingsSection title="Delivery zones" description="A zone update applies to every Barangay assigned to it." onSave={() => save('delivery')} saving={saving}>
              <div className="ac-zone-list">{zones.map((zone, index) => <article key={zone.zone}>
                <header><div><MapPin size={17}/><span><b>{zone.zone}</b><small>{zone.barangays.length} Barangay{zone.barangays.length === 1 ? '' : 's'}</small></span></div><Toggle checked={zone.active} onChange={(value) => updateZone(index, { active: value })} label={zone.active ? 'Active' : 'Inactive'}/></header>
                <div className="ac-form-grid"><Field label="Delivery fee (PHP)"><input type="number" min="0" step="1" value={zone.fee} onChange={(event) => updateZone(index, { fee: Number(event.target.value) })}/></Field><Field label="Estimated time"><input value={zone.estimatedTime} onChange={(event) => updateZone(index, { estimatedTime: event.target.value })} placeholder="e.g. 20–35 minutes"/></Field></div>
                <details><summary>View included Barangays</summary><p>{zone.barangays.join(', ')}</p></details>
              </article>)}</div>
            </SettingsSection>}

            {section === 'payments' && <SettingsSection title="Payments" description="Choose the methods customers can use and keep instructions accurate." onSave={() => save('payments')} saving={saving}>
              <div className="ac-payment-methods">
                {[['cod','Cash on delivery','Delivery orders only'],['gcash','GCash','Requires proof of payment'],['bank_transfer','Bank transfer','Requires proof of payment']].map(([id,label,hint]) => <Toggle key={id} checked={(settings.payments.enabledMethods || []).includes(id)} onChange={() => toggleMethod(id)} label={label} hint={hint}/>) }
              </div>
              <div className="ac-subsection"><h3>Cash on delivery</h3><div className="ac-form-grid"><Field label="Maximum order total (PHP)" hint="Orders above this amount must use a digital method."><input type="number" min="0" step="1" value={settings.payments.codMaximum} onChange={(event) => update('payments', { codMaximum: Number(event.target.value) })}/></Field></div></div>
              <div className="ac-subsection"><h3>GCash</h3><QrAssetEditor label="GCash payment QR" currentUrl={settings.payments.gcashQrUrl} file={qrFiles.gcash} onChange={(file) => setQrFiles((current) => ({ ...current, gcash: file }))} onError={setError}/><div className="ac-form-grid"><Field label="Customer instructions" wide><textarea rows="3" value={settings.payments.gcashInstructions} onChange={(event) => update('payments', { gcashInstructions: event.target.value })}/></Field></div></div>
              <div className="ac-subsection"><h3>Bank transfer</h3><QrAssetEditor label="Bank transfer QR" currentUrl={settings.payments.bankQrUrl} file={qrFiles.bank_transfer} onChange={(file) => setQrFiles((current) => ({ ...current, bank_transfer: file }))} onError={setError}/><div className="ac-form-grid"><Field label="Bank name"><input value={settings.payments.bankName} onChange={(event) => update('payments', { bankName: event.target.value })}/></Field><Field label="Account name"><input value={settings.payments.bankAccountName} onChange={(event) => update('payments', { bankAccountName: event.target.value })}/></Field><Field label="Account number"><input value={settings.payments.bankAccountNumber} onChange={(event) => update('payments', { bankAccountNumber: event.target.value })}/></Field><Field label="Customer instructions" wide><textarea rows="3" value={settings.payments.bankInstructions} onChange={(event) => update('payments', { bankInstructions: event.target.value })}/></Field></div></div>
            </SettingsSection>}

            {section === 'pricing' && <SettingsSection title="Pricing & VAT" description="One global policy applies to customers, cashiers, staff, reports, receipts, and new orders." onSave={() => save('pricing')} saving={saving}>
              <div className="ac-alert" role="status"><Info size={18}/><div><b>Current catalog prices are already VAT-inclusive</b><span>The system will not multiply or change the amounts already stored for menu items, variants, or add-ons.</span></div></div>
              <div className="ac-form-grid">
                <Field label="VAT rate" hint="The current store-wide rate used for order records."><input readOnly value={`${Math.round(Number(settings.pricing?.vatRate ?? 0.12) * 100)}%`}/></Field>
                <Field label="Price treatment" hint="This policy is shared by every user and channel."><input readOnly value={settings.pricing?.pricesIncludeVat !== false ? 'Prices include VAT' : 'VAT calculated at checkout'}/></Field>
                <Field label="Currency"><input readOnly value={settings.pricing?.currency || 'PHP'}/></Field>
              </div>
              <div className="ac-subsection"><h3>Visible to everyone</h3><p>Customers see the policy during browsing and checkout. Cashiers, staff, and administrators see the same notice in their work areas. New orders store the active VAT-inclusive policy for consistent records and reporting.</p></div>
            </SettingsSection>}

            {section === 'security' && <section className="ac-editor-section"><header><div><h2>Platform security</h2><p>Security controls are shown where they are actually managed.</p></div></header><div className="ac-security-grid">
              <article><span><ShieldCheck size={20}/></span><div><b>Role-based access</b><p>Admin, operations staff, cashier, and customer boundaries are enforced by protected routes and database policies.</p><a href="/admin/users-access/users">Manage users and roles</a></div></article>
              <article><span><Database size={20}/></span><div><b>Authentication policy</b><p>Password rules, OTP, session lifetime, and rate limits belong in Supabase Auth. They are not duplicated here because a local toggle would not enforce them.</p><small>Review these controls in the connected Supabase project.</small></div></article>
              <article><span><ShoppingBag size={20}/></span><div><b>Change history</b><p>Administrative changes remain attributable through the portal activity log.</p><a href="/admin/users-access/activity">Open Activity Logs</a></div></article>
            </div></section>}
          </>}
        </main>
      </div>
    </section>
    {notice && <div className="ac-toast" role="status"><Check size={17}/>{notice}</div>}
  </AppShell>
}

function SettingsSection({ title, description, onSave, saving, children }) {
  return <section className="ac-editor-section"><header><div><h2>{title}</h2><p>{description}</p></div></header><div className="ac-editor-body">{children}</div><footer><span>Review operational impact before saving.</span><button type="button" className="ac-primary-button" onClick={onSave} disabled={saving}><Save size={16}/>{saving ? 'Saving…' : 'Save settings'}</button></footer></section>
}

function QrAssetEditor({ label, currentUrl, file, onChange, onError }) {
  const [previewUrl, setPreviewUrl] = useState(currentUrl)
  useEffect(() => {
    if (!file) { setPreviewUrl(currentUrl); return undefined }
    const objectUrl = URL.createObjectURL(file)
    setPreviewUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [file, currentUrl])
  const choose = async (event) => {
    const next = event.target.files?.[0] || null
    if (!next) return
    try {
      await validateImageFile(next, { label: 'Payment QR image' })
      onError(''); onChange(next)
    } catch (error) {
      onError(error.message || 'Could not use this image.')
    }
    event.target.value = ''
  }
  return <section className="ac-qr-editor" aria-label={label}>
    <div className="ac-qr-preview">{previewUrl ? <img src={previewUrl} alt={`${label} preview`}/> : <span><Image size={24}/><small>No QR uploaded</small></span>}<i>{file ? 'New preview' : 'Current QR'}</i></div>
    <div className="ac-qr-copy"><b>{label}</b><p>{file ? `${file.name} is ready. Save Payments to publish this replacement.` : 'This is the QR customers currently see during checkout.'}</p><small>JPG, PNG or WEBP · Maximum 5 MB · A square, high-contrast image scans best.</small><div><label className="ac-secondary-button ac-file-button"><Upload size={16}/>{file ? 'Choose another' : 'Change QR'}<input type="file" accept={IMAGE_UPLOAD_ACCEPT} onChange={choose}/></label>{file && <button type="button" className="ac-text-button" onClick={() => onChange(null)}><RotateCcw size={15}/>Discard replacement</button>}</div></div>
  </section>
}
