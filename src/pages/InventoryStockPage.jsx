import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Archive, Bell, Box, Check, MoreVertical,
  Minus, Package, PackageMinus, PackagePlus, PackageX, Pencil, Plus, RefreshCw, Search, X,
} from 'lucide-react'
import AppShell from '../components/AppShell'
import { describeError } from '../utils/describeError'
import {
  fetchIngredients, fetchFinishedProducts, fetchSupplies, fetchMenuItemOptions,
  fetchMovements, fetchRecipeUsage,
  upsertIngredient, archiveIngredient, upsertFinishedProduct, archiveFinishedProduct,
  upsertSupply, archiveSupply, adjustStock,
} from '../services/opsInventoryService'
import { getCurrentPortalSession } from '../lib/auth'
import { fetchStaffPreferences, getRememberedStaffFilters, rememberStaffFilters, shouldShowSystemNotification } from '../services/staffSettingsService'

const ENTITY_CONFIGS = {
  ingredient: { key: 'ingredient', label: 'Ingredients', singular: 'Ingredient', fetch: fetchIngredients, upsert: upsertIngredient, archive: archiveIngredient, hasType: true },
  finished_product: { key: 'finished_product', label: 'Products', singular: 'Product', fetch: fetchFinishedProducts, upsert: upsertFinishedProduct, archive: archiveFinishedProduct, hasType: false, hasMenuLink: true },
  supply: { key: 'supply', label: 'Supplies', singular: 'Supply', fetch: fetchSupplies, upsert: upsertSupply, archive: archiveSupply, hasType: false },
}
const PAGE_SIZE = 25

function stockStatus(item) {
  if (item.quantity <= 0) return 'out'
  if (item.quantity <= item.minStockLevel) return 'low'
  if (item.highStockLevel > 0 && item.quantity > item.highStockLevel) return 'over'
  return 'healthy'
}
const STATUS_META = {
  out: { label: 'Out of Stock', tone: 'red' },
  low: { label: 'Low Stock', tone: 'amber' },
  healthy: { label: 'Healthy', tone: 'green' },
  over: { label: 'Over Stock', tone: 'blue' },
}
function formatQty(value) {
  const n = Number(value)
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}
function timeAgo(dateString) {
  if (!dateString) return '—'
  const diffMs = Date.now() - new Date(dateString).getTime()
  const minutes = Math.round(diffMs / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} day${days === 1 ? '' : 's'} ago`
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' }).format(new Date(dateString))
}

export default function InventoryStockPage() {
  const [activeEntity, setActiveEntity] = useState('ingredient')
  const [items, setItems] = useState([])
  const [menuItems, setMenuItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [busyId, setBusyId] = useState('')
  const [toasts, setToasts] = useState([])

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [sortBy, setSortBy] = useState('name')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(PAGE_SIZE)
  const [filtersReady, setFiltersReady] = useState(false)
  const [menuOpenId, setMenuOpenId] = useState('')

  const [formTarget, setFormTarget] = useState(null)
  const [drawerItem, setDrawerItem] = useState(null)
  const [adjustTarget, setAdjustTarget] = useState(null)
  const [archiveTarget, setArchiveTarget] = useState(null)

  const config = ENTITY_CONFIGS[activeEntity]

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  useEffect(() => {
    let active = true
    getCurrentPortalSession().then(async ({ profile }) => {
      if (!profile?.id) return
      try {
        const preferences = await fetchStaffPreferences(profile.id)
        if (!active) return
        const remembered = getRememberedStaffFilters('inventory')
        setActiveEntity(remembered?.activeEntity || preferences.inventory_tab)
        setStatusFilter(remembered?.statusFilter || preferences.inventory_filter)
        setPageSize(preferences.rows_per_page)
        if (remembered) {
          setSearch(remembered.search || '')
          setCategoryFilter(remembered.categoryFilter || 'all')
          setTypeFilter(remembered.typeFilter || 'all')
          setSortBy(remembered.sortBy || 'name')
        }
      } catch { /* Default inventory settings remain available before migration. */ }
      finally { if (active) setFiltersReady(true) }
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!filtersReady) return
    rememberStaffFilters('inventory', { activeEntity, search, categoryFilter, statusFilter, typeFilter, sortBy })
  }, [activeEntity, categoryFilter, filtersReady, search, sortBy, statusFilter, typeFilter])

  const load = async (entity = activeEntity) => {
    setLoading(true)
    try {
      const [data, menuOptions] = await Promise.all([ENTITY_CONFIGS[entity].fetch(), fetchMenuItemOptions()])
      setItems(data)
      setMenuItems(menuOptions)
      setError('')
    } catch (cause) {
      setError(describeError(cause, 'Could not load inventory.'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { setPage(1); load(activeEntity) }, [activeEntity])

  const pushToast = (type, message) => {
    if (!shouldShowSystemNotification(type)) return
    const id = crypto.randomUUID()
    setToasts((c) => [...c, { id, type, message }])
    setTimeout(() => setToasts((c) => c.filter((t) => t.id !== id)), 4500)
  }

  const categories = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean))].sort(), [items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => {
      if (q && !item.name.toLowerCase().includes(q)) return false
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false
      if (statusFilter !== 'all' && stockStatus(item) !== statusFilter) return false
      if (config.hasType && typeFilter !== 'all' && item.type !== typeFilter) return false
      return true
    })
  }, [items, search, categoryFilter, statusFilter, typeFilter, config.hasType])

  const sorted = useMemo(() => {
    const list = [...filtered]
    if (sortBy === 'name') list.sort((a, b) => a.name.localeCompare(b.name))
    else if (sortBy === 'quantity') list.sort((a, b) => a.quantity - b.quantity)
    else if (sortBy === 'updated') list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    return list
  }, [filtered, sortBy])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const pageItems = sorted.slice((page - 1) * pageSize, page * pageSize)

  const outCount = items.filter((i) => stockStatus(i) === 'out').length
  const lowCount = items.filter((i) => stockStatus(i) === 'low').length

  const runArchive = async (item) => {
    setBusyId(item.id)
    try {
      await config.archive(item.id)
      setItems((current) => current.filter((i) => i.id !== item.id))
      pushToast('success', `${item.name} was archived.`)
      setArchiveTarget(null)
    } catch (cause) {
      pushToast('error', describeError(cause, 'Could not archive this item.'))
    } finally {
      setBusyId('')
    }
  }

  const runSaveForm = async (payload) => {
    const id = await config.upsert(payload)
    await load(activeEntity)
    pushToast('success', `${payload.name} was saved.`)
    setFormTarget(null)
    return id
  }

  const runAdjust = async ({ delta, movementType, reason }) => {
    const target = adjustTarget
    setBusyId(target.item.id)
    try {
      const nextQty = await adjustStock({ itemType: config.key, itemId: target.item.id, delta, movementType, reason })
      setItems((current) => current.map((i) => (i.id === target.item.id ? { ...i, quantity: Number(nextQty) } : i)))
      pushToast('success', `${target.item.name} updated to ${formatQty(nextQty)} ${target.item.unit}.`)
      setAdjustTarget(null)
    } catch (cause) {
      pushToast('error', describeError(cause, 'Could not adjust stock.'))
    } finally {
      setBusyId('')
    }
  }

  const attentionCount = outCount + lowCount

  return (
    <AppShell role="staff" title="Inventory Stock Overview" titleActions={
      <div className="ops-order-view-toggle" role="tablist" aria-label="Inventory type">
        <button type="button" role="tab" aria-selected={activeEntity === 'ingredient'} className={activeEntity === 'ingredient' ? 'active' : ''} onClick={() => setActiveEntity('ingredient')}>Ingredients</button>
        <button type="button" role="tab" aria-selected={activeEntity === 'finished_product'} className={activeEntity === 'finished_product' ? 'active' : ''} onClick={() => setActiveEntity('finished_product')}>Products</button>
        <button type="button" role="tab" aria-selected={activeEntity === 'supply'} className={activeEntity === 'supply' ? 'active' : ''} onClick={() => setActiveEntity('supply')}>Supplies</button>
      </div>
    } actions={
      <div className="ops-header-actions">
        <div className="ops-clock">
          <span>{new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }).format(now)}</span>
          <b>{new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(now)}</b>
        </div>
        <button type="button" className="ops-icon-button" aria-label={`${attentionCount} item${attentionCount === 1 ? '' : 's'} need attention`} title="Items needing attention">
          <Bell size={18} />
          {attentionCount > 0 && <span className="ops-badge">{attentionCount}</span>}
        </button>
        <button type="button" className="ops-icon-button" aria-label="Refresh inventory" title="Refresh" onClick={() => load(activeEntity)} disabled={loading}>
          <RefreshCw size={18} className={loading ? 'spin' : ''} />
        </button>
      </div>
    }>
      {error && <p className="form-error">{error}</p>}

      <div className="inv-summary-row inventory-summary-grid">
        <article className="inv-summary-card tone-red"><span className="inv-summary-icon"><PackageX size={18} /></span><span className="inv-summary-copy"><span>Out of Stock</span><small>Needs replenishment</small></span><b>{outCount}</b></article>
        <article className="inv-summary-card tone-amber"><span className="inv-summary-icon"><AlertTriangle size={18} /></span><span className="inv-summary-copy"><span>Low Stock</span><small>Below alert level</small></span><b>{lowCount}</b></article>
        <article className="inv-summary-card tone-neutral"><span className="inv-summary-icon"><Package size={18} /></span><span className="inv-summary-copy"><span>Total Records</span><small>Tracked inventory</small></span><b>{items.length}</b></article>
      </div>

      <div className="inv-toolbar">
        <label className="ops-search">
          <Search size={17} /><span className="sr-only">Search {config.label.toLowerCase()}</span>
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder={`Search ${config.label.toLowerCase()}…`} />
        </label>
        <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1) }} aria-label="Filter by category">
          <option value="all">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }} aria-label="Filter by stock status">
          <option value="all">All statuses</option>
          {Object.entries(STATUS_META).map(([key, meta]) => <option key={key} value={key}>{meta.label}</option>)}
        </select>
        {config.hasType && (
          <select value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }} aria-label="Filter by type">
            <option value="all">All types</option><option value="wet">Wet</option><option value="dry">Dry</option><option value="other">Other</option>
          </select>
        )}
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort">
          <option value="name">Name: A to Z</option><option value="quantity">Quantity: lowest first</option><option value="updated">Recently updated</option>
        </select>
        <button type="button" className="ops-main-action inv-record-btn" onClick={() => setFormTarget({ item: null })}>
          <Plus size={16} /> Record New {config.singular}
        </button>
      </div>

      {loading ? (
        <InventorySkeleton />
      ) : pageItems.length === 0 ? (
        <div className="inv-empty"><Box size={28} /><h3>No {config.label.toLowerCase()} found</h3><p>Try adjusting your filters, or record a new {config.singular.toLowerCase()}.</p></div>
      ) : (
        <>
          <div className="inv-table-wrap">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>{config.singular} Name</th><th>Category</th>{config.hasType && <th>Type</th>}
                  <th>Quantity</th><th>Unit</th><th>Status</th><th>Low Stock Alert</th><th>Healthy Point</th><th>Last Updated</th><th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {pageItems.map((item) => {
                  const status = stockStatus(item)
                  return (
                    <tr key={item.id}>
                      <td><b>{item.name}</b></td>
                      <td>{item.category || '—'}</td>
                      {config.hasType && <td className="inv-capitalize">{item.type}</td>}
                      <td>{formatQty(item.quantity)}</td>
                      <td>{item.unit}</td>
                      <td><span className={`inv-status tone-${STATUS_META[status].tone}`}>{STATUS_META[status].label}</span></td>
                      <td>{formatQty(item.minStockLevel)}</td>
                      <td>{formatQty(item.highStockLevel)}</td>
                      <td>{timeAgo(item.updatedAt)}</td>
                      <td>
                        <RowActions item={item} busy={busyId === item.id} menuOpen={menuOpenId === item.id}
                          onToggleMenu={() => setMenuOpenId((id) => (id === item.id ? '' : item.id))}
                          onView={() => { setDrawerItem(item); setMenuOpenId('') }}
                          onAdd={() => { setAdjustTarget({ item, mode: 'restock' }); setMenuOpenId('') }}
                          onDeduct={() => { setAdjustTarget({ item, mode: 'deduction' }); setMenuOpenId('') }}
                          onEdit={() => { setFormTarget({ item }); setMenuOpenId('') }}
                          onArchive={() => { setArchiveTarget(item); setMenuOpenId('') }} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="inv-cards">
            {pageItems.map((item) => {
              const status = stockStatus(item)
              return (
                <article className="inv-card" key={item.id}>
                  <div className="inv-card-top"><b>{item.name}</b><span className={`inv-status tone-${STATUS_META[status].tone}`}>{STATUS_META[status].label}</span></div>
                  <p className="inv-card-meta">{item.category || 'Uncategorized'}{config.hasType ? ` · ${item.type}` : ''}</p>
                  <p className="inv-card-qty">{formatQty(item.quantity)} {item.unit}</p>
                  <p className="inv-card-thresholds">Low: {formatQty(item.minStockLevel)} · Healthy: {formatQty(item.highStockLevel)} · Updated {timeAgo(item.updatedAt)}</p>
                  <div className="inv-card-actions">
                    <button type="button" className="ops-secondary-action" onClick={() => setDrawerItem(item)}>View</button>
                    <button type="button" className="ops-secondary-action" onClick={() => setAdjustTarget({ item, mode: 'restock' })}><PackagePlus size={14} /> Add</button>
                    <button type="button" className="ops-secondary-action" onClick={() => setAdjustTarget({ item, mode: 'deduction' })}><PackageMinus size={14} /> Deduct</button>
                    <button type="button" className="ops-secondary-action" onClick={() => setFormTarget({ item })}><Pencil size={14} /> Edit</button>
                  </div>
                </article>
              )
            })}
          </div>

          {totalPages > 1 && (
            <div className="inv-pagination">
              <button type="button" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
              <span>Page {page} of {totalPages}</span>
              <button type="button" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
            </div>
          )}
        </>
      )}

      {formTarget && (
        <ItemFormModal config={config} item={formTarget.item} menuItems={menuItems} onClose={() => setFormTarget(null)} onSave={runSaveForm} />
      )}
      {drawerItem && (
        <ItemDrawer config={config} item={items.find((i) => i.id === drawerItem.id) || drawerItem} onClose={() => setDrawerItem(null)}
          onAdd={() => { setAdjustTarget({ item: drawerItem, mode: 'restock' }); setDrawerItem(null) }}
          onDeduct={() => { setAdjustTarget({ item: drawerItem, mode: 'deduction' }); setDrawerItem(null) }}
          onEdit={() => { setFormTarget({ item: drawerItem }); setDrawerItem(null) }} />
      )}
      {adjustTarget && (
        <AdjustStockModal target={adjustTarget} busy={busyId === adjustTarget.item.id} onClose={() => setAdjustTarget(null)} onConfirm={runAdjust} />
      )}
      {archiveTarget && (
        <ArchiveConfirmModal item={archiveTarget} busy={busyId === archiveTarget.id} onClose={() => setArchiveTarget(null)} onConfirm={() => runArchive(archiveTarget)} />
      )}

      <div className="ops-toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div className={`ops-toast ops-toast-${t.type}`} key={t.id}>{t.type === 'success' ? <Check size={15} /> : <AlertTriangle size={15} />} {t.message}</div>)}
      </div>
    </AppShell>
  )
}

function InventorySkeleton() {
  return <div className="inv-skeleton">{Array.from({ length: 6 }).map((_, i) => <div className="inv-skeleton-row" key={i} />)}</div>
}

function RowActions({ item, busy, menuOpen, onToggleMenu, onView, onAdd, onDeduct, onEdit, onArchive }) {
  return (
    <div className="inv-row-actions">
      <button type="button" className="ops-secondary-action compact" onClick={onView}>View</button>
      <button type="button" className="ops-icon-button small inv-action-add" aria-label={`Add stock for ${item.name}`} title="Add stock" onClick={onAdd} disabled={busy}><Plus size={15} /></button>
      <button type="button" className="ops-icon-button small inv-action-deduct" aria-label={`Deduct stock for ${item.name}`} title="Deduct stock" onClick={onDeduct} disabled={busy}><Minus size={15} /></button>
      <div className="inv-overflow">
        <button type="button" className="ops-icon-button small inv-action-more" aria-label={`More actions for ${item.name}`} aria-expanded={menuOpen} onClick={onToggleMenu}><MoreVertical size={15} /></button>
        {menuOpen && (
          <div className="inv-overflow-menu" role="menu">
            <button type="button" role="menuitem" onClick={onEdit}><Pencil size={14} /> Edit item</button>
            <button type="button" role="menuitem" className="danger" onClick={onArchive}><Archive size={14} /> Archive item</button>
          </div>
        )}
      </div>
    </div>
  )
}

function ItemFormModal({ config, item, menuItems, onClose, onSave }) {
  const [values, setValues] = useState({
    name: item?.name || '', category: item?.category || '', type: item?.type || 'other', unit: item?.unit || '',
    minStockLevel: item?.minStockLevel ?? 10, highStockLevel: item?.highStockLevel ?? (config.key === 'ingredient' ? 500 : 100),
    supplier: item?.supplier || '', notes: item?.notes || '', initialQuantity: item ? item.quantity : 0,
    menuItemId: item?.menuItemId || '', saleMappings: item?.saleMappings || (item?.menuItemId ? [{ menuItemId: item.menuItemId, variantKey: '', unitsPerSale: 1 }] : []),
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (key, value) => setValues((c) => ({ ...c, [key]: value }))

  const submit = async (event) => {
    event.preventDefault()
    if (!values.name.trim()) return setError('Item name is required.')
    if (!values.unit.trim()) return setError('Unit is required.')
    const min = Number(values.minStockLevel)
    const high = Number(values.highStockLevel)
    if (Number.isNaN(min) || min < 0) return setError('Low-stock threshold must be zero or greater.')
    if (Number.isNaN(high) || high < 0) return setError('Healthy-stock target must be zero or greater.')
    if (high > 0 && min > high) return setError('The low-stock threshold cannot exceed the healthy-stock target.')
    if (config.hasMenuLink && values.saleMappings.some((mapping) => !mapping.menuItemId || Number(mapping.unitsPerSale) <= 0)) return setError('Choose a menu item and a positive inventory quantity for every sale format.')
    if (!item) {
      const initial = Number(values.initialQuantity)
      if (Number.isNaN(initial) || initial < 0) return setError('Starting quantity cannot be negative.')
    }
    setSaving(true); setError('')
    try {
      await onSave({ id: item?.id, ...values, menuItemId: values.saleMappings[0]?.menuItemId || null, minStockLevel: min, highStockLevel: high, initialQuantity: Number(values.initialQuantity) })
    } catch (cause) {
      setError(describeError(cause, 'Could not save this item.'))
      setSaving(false)
    }
  }

  return (
    <div className="payment-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose() }}>
      <section className="payment-modal inv-form-modal" role="dialog" aria-modal="true" aria-labelledby="inv-form-title" aria-describedby="inv-form-description">
        <button className="payment-modal-close" type="button" onClick={onClose} disabled={saving} aria-label="Close">×</button>
        <header className="inv-form-header"><span className="inv-form-icon"><Package size={20} /></span><div><span>{item ? `Editing ${config.singular.toLowerCase()}` : `New ${config.singular.toLowerCase()}`}</span><h2 id="inv-form-title">{item ? item.name : `Add ${config.singular.toLowerCase()} stock`}</h2><p id="inv-form-description">{config.key === 'finished_product' ? 'Set the stock unit, then define how each menu format uses this product.' : 'Add the item details, stock levels, and replenishment thresholds.'}</p></div></header>
        <form className="inv-record-form" onSubmit={submit}>
          <section className="inv-form-section"><header><h3>Item details</h3><p>How this item will appear in inventory.</p></header><div className="form-grid">
            <label className="field"><span>{config.singular} name</span><input value={values.name} onChange={(e) => set('name', e.target.value)} required /></label>
            <label className="field"><span>Category</span><input value={values.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Milk, Protein, Syrup" /></label>
            {config.hasType && (
              <label className="field"><span>Type</span>
                <select value={values.type} onChange={(e) => set('type', e.target.value)}>
                  <option value="wet">Wet</option><option value="dry">Dry</option><option value="other">Other</option>
                </select>
              </label>
            )}
          </div></section>
          <section className="inv-form-section"><header><h3>Stock levels</h3><p>Use the same unit for the quantity and thresholds.</p></header><div className="form-grid">
            <label className="field"><span>Unit</span><input value={values.unit} onChange={(e) => set('unit', e.target.value)} placeholder={config.key === 'finished_product' ? 'piece, slice, box' : 'kg, L, pcs'} required /></label>
            {!item && <label className="field"><span>Starting quantity</span><input type="number" min="0" step="any" value={values.initialQuantity} onChange={(e) => set('initialQuantity', e.target.value)} /></label>}
            <label className="field"><span>Low-stock threshold</span><input type="number" min="0" step="any" value={values.minStockLevel} onChange={(e) => set('minStockLevel', e.target.value)} required /></label>
            <label className="field"><span>Healthy-stock target</span><input type="number" min="0" step="any" value={values.highStockLevel} onChange={(e) => set('highStockLevel', e.target.value)} required /></label>
          </div></section>
          {config.hasMenuLink && (
            <fieldset className="inv-sale-mappings">
              <legend>How this product is sold</legend>
              <p>Link each menu format to the number of inventory units it uses. A box of six cookies uses 6 pieces.</p>
              {values.saleMappings.map((mapping, index) => {
                const selectedMenuItem = menuItems.find((menuItem) => menuItem.id === mapping.menuItemId)
                const variants = Object.keys(selectedMenuItem?.variant_options?.prices || {})
                const updateMapping = (key, value) => set('saleMappings', values.saleMappings.map((entry, entryIndex) => entryIndex === index ? { ...entry, [key]: value } : entry))
                return <div className="inv-sale-mapping" key={index}>
                  <select value={mapping.menuItemId} onChange={(e) => updateMapping('menuItemId', e.target.value)} aria-label="Menu item"><option value="">Select menu item</option>{menuItems.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
                  <select value={mapping.variantKey} onChange={(e) => updateMapping('variantKey', e.target.value)} aria-label="Menu variant"><option value="">Default sale</option>{variants.map((variant) => <option key={variant} value={variant}>{variant}</option>)}</select>
                  <input type="number" min="0.001" step="any" value={mapping.unitsPerSale} onChange={(e) => updateMapping('unitsPerSale', e.target.value)} aria-label="Inventory units per sale" placeholder="Units per sale" />
                  <button type="button" className="ops-secondary-action compact" onClick={() => set('saleMappings', values.saleMappings.filter((_, entryIndex) => entryIndex !== index))}>Remove</button>
                </div>
              })}
              <button type="button" className="ops-secondary-action compact" onClick={() => set('saleMappings', [...values.saleMappings, { menuItemId: '', variantKey: '', unitsPerSale: 1 }])}>Add sale format</button>
            </fieldset>
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="payment-modal-actions inv-form-actions">
            <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function AdjustStockModal({ target, busy, onClose, onConfirm }) {
  const { item } = target
  const [direction, setDirection] = useState(target.mode === 'deduction' ? 'deduction' : 'restock')
  const [movementType, setMovementType] = useState(target.mode === 'deduction' ? 'deduction' : 'restock')
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [reference, setReference] = useState('')
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(false)

  const numericAmount = Number(amount)
  const validAmount = amount !== '' && !Number.isNaN(numericAmount) && numericAmount > 0
  const resulting = validAmount ? item.quantity + (direction === 'restock' ? numericAmount : -numericAmount) : null
  const wouldGoNegative = resulting !== null && resulting < 0

  useEffect(() => { setMovementType(direction === 'restock' ? 'restock' : 'deduction') }, [direction])

  const submit = (event) => {
    event.preventDefault()
    if (!validAmount) return setError('Enter an amount greater than zero.')
    if (wouldGoNegative) return setError('This would take stock below zero.')
    if (!reason.trim()) return setError('A reason is required.')
    setError('')
    setConfirming(true)
  }

  if (confirming) {
    return (
      <div className="payment-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) setConfirming(false) }}>
        <section className="payment-modal" role="alertdialog" aria-modal="true" aria-labelledby="inv-confirm-title">
          <span className="payment-modal-kicker">Confirm stock change</span>
          <h2 id="inv-confirm-title">{direction === 'restock' ? 'Add' : 'Deduct'} {formatQty(numericAmount)} {item.unit} {direction === 'restock' ? 'to' : 'from'} {item.name}?</h2>
          <div className="inv-adjust-preview">
            <div><span>Current</span><b>{formatQty(item.quantity)} {item.unit}</b></div>
            <div className="inv-adjust-arrow">→</div>
            <div><span>Resulting</span><b>{formatQty(resulting)} {item.unit}</b></div>
          </div>
          <p><b>Reason:</b> {reason}{reference ? ` — Ref: ${reference}` : ''}</p>
          <div className="payment-modal-actions">
            <button className="secondary-button" type="button" onClick={() => setConfirming(false)} disabled={busy}>Go back</button>
            <button className="primary-button" type="button" disabled={busy} onClick={() => onConfirm({ delta: direction === 'restock' ? numericAmount : -numericAmount, movementType, reason: reference ? `${reason} — Ref: ${reference}` : reason })}>
              {busy ? 'Saving…' : 'Confirm'}
            </button>
          </div>
        </section>
      </div>
    )
  }

  return (
    <div className="payment-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <section className="payment-modal" role="dialog" aria-modal="true" aria-labelledby="inv-adjust-title">
        <button className="payment-modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
        <span className="payment-modal-kicker">Stock adjustment</span>
        <h2 id="inv-adjust-title">{item.name}</h2>
        <form onSubmit={submit}>
          <div className="inv-direction-toggle">
            <button type="button" className={direction === 'restock' ? 'active' : ''} onClick={() => setDirection('restock')}><PackagePlus size={15} /> Add</button>
            <button type="button" className={direction === 'deduction' ? 'active' : ''} onClick={() => setDirection('deduction')}><PackageMinus size={15} /> Deduct</button>
          </div>
          <div className="form-grid">
            <label className="field"><span>Amount ({item.unit})</span><input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
            <label className="field"><span>Movement type</span>
              <select value={movementType} onChange={(e) => setMovementType(e.target.value)}>
                {direction === 'restock' ? <option value="restock">Restock</option> : <><option value="deduction">Deduction</option><option value="waste">Waste</option></>}
                <option value="adjustment">Adjustment</option>
              </select>
            </label>
          </div>
          <label className="field"><span>Reason</span><textarea rows="2" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Weekly delivery, spoilage, recount…" required /></label>
          <label className="field"><span>Reference / supplier / order (optional)</span><input value={reference} onChange={(e) => setReference(e.target.value)} /></label>
          {validAmount && (
            <div className="inv-adjust-preview compact">
              <div><span>Current</span><b>{formatQty(item.quantity)} {item.unit}</b></div>
              <div className="inv-adjust-arrow">→</div>
              <div><span>Resulting</span><b className={wouldGoNegative ? 'inv-negative' : ''}>{formatQty(resulting)} {item.unit}</b></div>
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
          <div className="payment-modal-actions">
            <button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
            <button className="primary-button" type="submit">Review</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function ArchiveConfirmModal({ item, busy, onClose, onConfirm }) {
  return (
    <div className="payment-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <section className="payment-modal" role="alertdialog" aria-modal="true" aria-labelledby="inv-archive-title">
        <span className="payment-modal-kicker">Archive item</span>
        <h2 id="inv-archive-title">Archive {item.name}?</h2>
        <p>This removes it from active inventory lists without deleting its stock history or recipe links. You can restore it later from the database if needed.</p>
        <div className="payment-modal-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Keep item</button>
          <button className="danger-button" type="button" disabled={busy} onClick={onConfirm}>{busy ? 'Archiving…' : 'Archive item'}</button>
        </div>
      </section>
    </div>
  )
}

function ItemDrawer({ config, item, onClose, onAdd, onDeduct, onEdit }) {
  const [movements, setMovements] = useState([])
  const [recipeUsage, setRecipeUsage] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const status = stockStatus(item)

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([
      fetchMovements(config.key, item.id),
      config.key === 'ingredient' ? fetchRecipeUsage(item.id) : Promise.resolve([]),
    ]).then(([m, r]) => { if (active) { setMovements(m); setRecipeUsage(r); setLoadError('') } })
      .catch((cause) => { if (active) setLoadError(describeError(cause, 'Could not load item history.')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [config.key, item.id])

  return (
    <div className="ops-drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="ops-drawer" role="dialog" aria-modal="true" aria-labelledby="inv-drawer-title">
        <header>
          <div><span className="settings-kicker">{config.singular}</span><h2 id="inv-drawer-title">{item.name}</h2></div>
          <button type="button" onClick={onClose} aria-label="Close item details"><X size={20} /></button>
        </header>
        <div className="ops-drawer-body">
          <section>
            <h3>Current stock</h3>
            <p><b>{formatQty(item.quantity)} {item.unit}</b> <span className={`inv-status tone-${STATUS_META[status].tone}`}>{STATUS_META[status].label}</span></p>
          </section>
          <section>
            <h3>Thresholds</h3>
            <p>Low-stock alert: {formatQty(item.minStockLevel)} {item.unit}</p>
            <p>Healthy-stock target: {formatQty(item.highStockLevel)} {item.unit}</p>
          </section>
          <section>
            <h3>Item information</h3>
            <p>Category: {item.category || '—'}</p>
            {config.hasType && <p className="inv-capitalize">Type: {item.type}</p>}
            {item.supplier && <p>Supplier: {item.supplier}</p>}
            {item.notes && <p>Notes: {item.notes}</p>}
          </section>
          {config.key === 'ingredient' && (
            <section>
              <h3>Used in</h3>
              {recipeUsage.length === 0 ? <p className="ops-proof-pending">Not used in any recipe yet.</p> : recipeUsage.map((r) => <p key={r.menuItemId}>{r.name} — {formatQty(r.quantityPerServing)} {item.unit} per serving</p>)}
            </section>
          )}
          <section>
            <h3>Recent stock movements</h3>
            {loadError && <p className="form-error">{loadError}</p>}
            {loading ? <p className="ops-proof-pending">Loading…</p> : movements.length === 0 ? <p className="ops-proof-pending">No stock movements recorded yet.</p> : (
              <ul className="inv-movement-list">
                {movements.map((m) => (
                  <li key={m.id}>
                    <span className={`inv-movement-type ${m.movement_type}`}>{m.movement_type}</span>
                    <b>{m.movement_type === 'restock' ? '+' : '−'}{formatQty(m.quantity)} {item.unit}</b>
                    <span className="inv-movement-meta">{m.reason || 'No reason given'} · {m.staffName} · {timeAgo(m.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <footer className="ops-drawer-footer">
          <button type="button" className="ops-main-action" onClick={onAdd}><PackagePlus size={16} /> Add Stock</button>
          <button type="button" className="ops-secondary-action" onClick={onDeduct}><PackageMinus size={16} /> Deduct</button>
          <button type="button" className="ops-secondary-action" onClick={onEdit}><Pencil size={16} /> Edit</button>
        </footer>
      </aside>
    </div>
  )
}
