import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Archive, Bell, Box, Check, Coffee, Copy, Eye, ExternalLink,
  Grid, ImagePlus, List, MoreVertical, Package, PackageX, Pencil, Plus, RefreshCw, Search, Settings2, ShoppingBag, Star, Tags, TrendingUp, X,
} from 'lucide-react'
import AppShell from '../components/AppShell'
import { money } from '../utils/money'
import { describeError } from '../utils/describeError'
import { supabase } from '../lib/supabase'
import {
  fetchMainCategories, fetchSubcategories, fetchManageMenuItems, fetchIngredientOptions, fetchMenuItemRecipe,
  upsertMainCategory, archiveMainCategory, upsertSubcategory, archiveSubcategory,
  upsertMenuItem, setMenuItemAvailability, archiveMenuItem, duplicateMenuItem, setMenuItemRecipe, uploadMenuItemImage,
} from '../services/manageMenuService'

const REASON_META = {
  manual: { label: 'Manually disabled', tone: 'neutral' },
  missing_ingredient: { label: 'Missing ingredient', tone: 'red' },
  insufficient_stock: { label: 'Low ingredient stock', tone: 'amber' },
  archived: { label: 'Archived', tone: 'neutral' },
  scheduled: { label: 'Scheduled availability', tone: 'blue' },
}
const TEMP_LABEL = { none: 'No temperature', hot_only: 'Hot only', iced_only: 'Iced only', flexible: 'Flexible' }
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

export default function ManageMenuPage() {
  const [mainCategories, setMainCategories] = useState([])
  const [subcategories, setSubcategories] = useState([])
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(() => new Date())
  const [busyId, setBusyId] = useState('')
  const [toasts, setToasts] = useState([])

  const [tab, setTab] = useState('all')
  const [subcategoryFilter, setSubcategoryFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [availabilityFilter, setAvailabilityFilter] = useState('all')
  const [customizableFilter, setCustomizableFilter] = useState('all')
  const [minPrice, setMinPrice] = useState('')
  const [maxPrice, setMaxPrice] = useState('')
  const [sortBy, setSortBy] = useState('name')
  const [view, setView] = useState('grid')
  const [selectedIds, setSelectedIds] = useState([])
  const [menuOpenId, setMenuOpenId] = useState('')

  const [formTarget, setFormTarget] = useState(null)
  const [drawerItem, setDrawerItem] = useState(null)
  const [archiveTarget, setArchiveTarget] = useState(null)
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false)

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])

  const load = async () => {
    setLoading(true)
    try {
      const [cats, subs, menu] = await Promise.all([fetchMainCategories(), fetchSubcategories(), fetchManageMenuItems()])
      setMainCategories(cats); setSubcategories(subs); setItems(menu); setError('')
    } catch (cause) {
      setError(describeError(cause, 'Could not load the menu.'))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  useEffect(() => {
    const channel = supabase
      .channel('manage-menu-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'main_categories' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'subcategories' }, () => load())
      .subscribe()
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { supabase.removeChannel(channel); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  const pushToast = (type, message) => {
    const id = crypto.randomUUID()
    setToasts((c) => [...c, { id, type, message }])
    setTimeout(() => setToasts((c) => c.filter((t) => t.id !== id)), 4500)
  }

  const activeSubcategories = useMemo(() => {
    const usedIds = new Set(items.filter((i) => !i.isArchived).map((i) => i.subcategoryId))
    return subcategories.filter((s) => !s.is_archived && usedIds.has(s.id))
  }, [subcategories, items])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const min = minPrice !== '' ? Number(minPrice) : null
    const max = maxPrice !== '' ? Number(maxPrice) : null
    return items.filter((item) => {
      if (tab === 'archived' && !item.isArchived) return false
      if (tab !== 'archived' && item.isArchived) return false
      if (tab === 'available' && !item.available) return false
      if (tab === 'unavailable' && item.available) return false
      if (subcategoryFilter !== 'all' && item.subcategoryId !== subcategoryFilter) return false
      if (q && !item.name.toLowerCase().includes(q) && !item.description.toLowerCase().includes(q)) return false
      if (availabilityFilter === 'available' && !item.available) return false
      if (availabilityFilter === 'unavailable' && item.available) return false
      if (customizableFilter === 'customizable' && !(item.allowIce || item.allowSugar || item.allowAddons || item.temperatureType === 'flexible')) return false
      if (customizableFilter === 'fixed' && (item.allowIce || item.allowSugar || item.allowAddons || item.temperatureType === 'flexible')) return false
      if (min !== null && item.price < min) return false
      if (max !== null && item.price > max) return false
      return true
    })
  }, [items, tab, subcategoryFilter, search, availabilityFilter, customizableFilter, minPrice, maxPrice])

  const sorted = useMemo(() => {
    const list = [...filtered]
    if (sortBy === 'name') list.sort((a, b) => a.name.localeCompare(b.name))
    else if (sortBy === 'price') list.sort((a, b) => a.price - b.price)
    else if (sortBy === 'newest') list.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    else if (sortBy === 'updated') list.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
    return list
  }, [filtered, sortBy])

  const activeItems = items.filter((i) => !i.isArchived)
  const availableCount = activeItems.filter((i) => i.available).length
  const drinkMainId = mainCategories.find((c) => (c.name || '').toLowerCase().includes('drink'))?.id
  const foodMainId = mainCategories.find((c) => (c.name || '').toLowerCase().includes('food'))?.id
  const drinksCount = activeItems.filter((i) => i.mainCategoryId === drinkMainId).length
  const foodsCount = activeItems.filter((i) => i.mainCategoryId === foodMainId).length
  const unavailableCount = activeItems.length - availableCount

  const toggleSelect = (id) => setSelectedIds((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))
  const clearSelection = () => setSelectedIds([])

  const runToggleAvailability = async (item) => {
    setBusyId(item.id)
    try {
      await setMenuItemAvailability(item.id, !item.manualAvailable)
      pushToast('success', `${item.name} is now ${!item.manualAvailable ? 'available' : 'unavailable'}.`)
      await load()
    } catch (cause) {
      pushToast('error', describeError(cause, 'Could not update availability.'))
    } finally {
      setBusyId('')
    }
  }

  const runDuplicate = async (item) => {
    setBusyId(item.id)
    try {
      await duplicateMenuItem(item.id)
      pushToast('success', `${item.name} was duplicated.`)
      await load()
    } catch (cause) {
      pushToast('error', describeError(cause, 'Could not duplicate this item.'))
    } finally {
      setBusyId('')
    }
  }

  const runArchive = async (item) => {
    setBusyId(item.id)
    try {
      await archiveMenuItem(item.id)
      pushToast('success', `${item.name} was archived.`)
      setArchiveTarget(null)
      await load()
    } catch (cause) {
      pushToast('error', describeError(cause, 'Could not archive this item.'))
    } finally {
      setBusyId('')
    }
  }

  const runBulkAvailability = async (available) => {
    setBusyId('bulk')
    try {
      await Promise.all(selectedIds.map((id) => setMenuItemAvailability(id, available)))
      pushToast('success', `Updated ${selectedIds.length} item${selectedIds.length === 1 ? '' : 's'}.`)
      clearSelection()
      await load()
    } catch (cause) {
      pushToast('error', describeError(cause, 'Could not update the selected items.'))
    } finally {
      setBusyId('')
    }
  }

  const attentionCount = unavailableCount

  return (
    <AppShell role="staff" title="Manage Menu" eyebrow="Maintain drinks and foods with clean category filtering." actions={
      <div className="ops-header-actions">
        <div className="ops-clock">
          <span>{new Intl.DateTimeFormat('en-PH', { weekday: 'short', month: 'short', day: 'numeric' }).format(now)}</span>
          <b>{new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true }).format(now)}</b>
        </div>
        <button type="button" className="ops-icon-button" aria-label={`${attentionCount} unavailable`} title="Unavailable items">
          <Bell size={18} />
          {attentionCount > 0 && <span className="ops-badge">{attentionCount}</span>}
        </button>
        <button type="button" className="ops-icon-button" aria-label="Refresh menu" title="Refresh" onClick={load} disabled={loading}>
          <RefreshCw size={18} className={loading ? 'spin' : ''} />
        </button>
        <button type="button" className="ops-main-action inv-record-btn" onClick={() => setFormTarget({ item: null })}><Plus size={16} /> Add Item</button>
      </div>
    }>
      {error && <p className="form-error">{error}</p>}

      <div className="inv-summary-row">
        <div className="inv-summary-card tone-neutral"><Box size={18} /><span>Active Menu Items</span><b>{activeItems.length}</b></div>
        <div className="inv-summary-card tone-green"><ShoppingBag size={18} /><span>Available Now</span><b>{availableCount}</b></div>
        <div className="inv-summary-card tone-blue"><Coffee size={18} /><span>Drinks</span><b>{drinksCount}</b></div>
        <div className="inv-summary-card tone-amber"><Package size={18} /><span>Foods</span><b>{foodsCount}</b></div>
        <div className="inv-summary-card tone-red"><PackageX size={18} /><span>Unavailable</span><b>{unavailableCount}</b></div>
      </div>

      <div className="menu-manage-tools">
        <label className="menu-manage-search">
          <Search size={17} /><span className="sr-only">Search menu items</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search drinks, cakes, and meals" />
          {search && <button type="button" className="menu-manage-search-clear" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}
        </label>
        <div className="menu-manage-chip-row">
          <button type="button" className={`menu-manage-chip ${subcategoryFilter === 'all' ? 'active' : ''}`} onClick={() => setSubcategoryFilter('all')}>All</button>
          {activeSubcategories.map((s) => (
            <button type="button" key={s.id} className={`menu-manage-chip ${subcategoryFilter === s.id ? 'active' : ''}`} onClick={() => setSubcategoryFilter(s.id)}>{s.display_name || s.name}</button>
          ))}
        </div>
      </div>

      <div className="inv-toolbar">
        <button type="button" className="ops-secondary-action compact" onClick={() => setFiltersOpen((v) => !v)}><Settings2 size={14} /> Filters</button>
        <button type="button" className="ops-secondary-action compact" onClick={() => setCategoryManagerOpen(true)}><Tags size={14} /> Manage Categories</button>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} aria-label="Sort">
          <option value="name">Name: A to Z</option><option value="price">Price: lowest first</option><option value="newest">Newest first</option><option value="updated">Recently updated</option>
        </select>
        <div className="menu-view-toggle">
          <button type="button" className={view === 'grid' ? 'active' : ''} aria-label="Grid view" onClick={() => setView('grid')}><Grid size={16} /></button>
          <button type="button" className={view === 'list' ? 'active' : ''} aria-label="List view" onClick={() => setView('list')}><List size={16} /></button>
        </div>
        <a className="ops-secondary-action compact" href="/menu" target="_blank" rel="noreferrer"><ExternalLink size={14} /> Preview as Customer</a>
      </div>

      {filtersOpen && (
        <div className="inv-toolbar menu-extra-filters">
          <select value={availabilityFilter} onChange={(e) => setAvailabilityFilter(e.target.value)} aria-label="Filter by availability">
            <option value="all">All availability</option><option value="available">Available</option><option value="unavailable">Unavailable</option>
          </select>
          <select value={customizableFilter} onChange={(e) => setCustomizableFilter(e.target.value)} aria-label="Filter by customization">
            <option value="all">Customizable or fixed</option><option value="customizable">Customizable</option><option value="fixed">Fixed</option>
          </select>
          <label className="field compact"><span>Min price</span><input type="number" min="0" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} /></label>
          <label className="field compact"><span>Max price</span><input type="number" min="0" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} /></label>
          <button type="button" className="ops-secondary-action compact" onClick={() => { setAvailabilityFilter('all'); setCustomizableFilter('all'); setMinPrice(''); setMaxPrice('') }}>Clear filters</button>
        </div>
      )}

      <div className="inv-tabs" role="tablist">
        {[['all', 'All Items'], ['available', 'Available Now'], ['unavailable', 'Unavailable'], ['archived', 'Archived']].map(([key, label]) => (
          <button type="button" key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => { setTab(key); clearSelection() }}>{label}</button>
        ))}
      </div>

      {selectedIds.length > 0 && (
        <div className="menu-bulk-bar">
          <span>{selectedIds.length} selected</span>
          <button type="button" className="ops-secondary-action compact" disabled={busyId === 'bulk'} onClick={() => runBulkAvailability(true)}>Mark Available</button>
          <button type="button" className="ops-secondary-action compact" disabled={busyId === 'bulk'} onClick={() => runBulkAvailability(false)}>Mark Unavailable</button>
          <button type="button" className="ops-secondary-action compact" onClick={clearSelection}>Clear</button>
        </div>
      )}

      {loading ? (
        <div className="inv-skeleton">{Array.from({ length: 6 }).map((_, i) => <div className="inv-skeleton-row" key={i} />)}</div>
      ) : sorted.length === 0 ? (
        <div className="inv-empty"><Box size={28} /><h3>No menu items found</h3><p>Try adjusting your filters, or add a new item.</p></div>
      ) : (
        <div className={view === 'grid' ? 'menu-item-grid' : 'menu-item-list'}>
          {sorted.map((item) => (
            <MenuItemCard
              key={item.id} item={item} view={view} busy={busyId === item.id}
              selected={selectedIds.includes(item.id)} onToggleSelect={() => toggleSelect(item.id)}
              menuOpen={menuOpenId === item.id} onToggleMenu={() => setMenuOpenId((id) => (id === item.id ? '' : item.id))}
              onView={() => { setDrawerItem(item); setMenuOpenId('') }}
              onEdit={() => { setFormTarget({ item }); setMenuOpenId('') }}
              onToggleAvailability={() => runToggleAvailability(item)}
              onDuplicate={() => { runDuplicate(item); setMenuOpenId('') }}
              onArchive={() => { setArchiveTarget(item); setMenuOpenId('') }}
            />
          ))}
        </div>
      )}

      {formTarget && (
        <ItemFormModal
          item={formTarget.item} mainCategories={mainCategories} subcategories={subcategories}
          onClose={() => setFormTarget(null)}
          onSave={async (payload) => { const id = await upsertMenuItem(payload); await load(); pushToast('success', `${payload.name} was saved.`); setFormTarget(null); return id }}
        />
      )}
      {drawerItem && (
        <ItemDrawer item={items.find((i) => i.id === drawerItem.id) || drawerItem}
          onClose={() => setDrawerItem(null)}
          onEdit={() => { setFormTarget({ item: drawerItem }); setDrawerItem(null) }}
          onToggleAvailability={() => runToggleAvailability(drawerItem)}
        />
      )}
      {archiveTarget && (
        <div className="payment-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && busyId !== archiveTarget.id) setArchiveTarget(null) }}>
          <section className="payment-modal" role="alertdialog" aria-modal="true" aria-labelledby="menu-archive-title">
            <span className="payment-modal-kicker">Archive item</span>
            <h2 id="menu-archive-title">Archive {archiveTarget.name}?</h2>
            <p>It will disappear from the customer menu and active lists, but stays linked to past orders, receipts, and recipes.</p>
            <div className="payment-modal-actions">
              <button className="secondary-button" type="button" onClick={() => setArchiveTarget(null)} disabled={busyId === archiveTarget.id}>Keep item</button>
              <button className="danger-button" type="button" disabled={busyId === archiveTarget.id} onClick={() => runArchive(archiveTarget)}>{busyId === archiveTarget.id ? 'Archiving…' : 'Archive item'}</button>
            </div>
          </section>
        </div>
      )}
      {categoryManagerOpen && (
        <CategoryManagerModal
          mainCategories={mainCategories} subcategories={subcategories}
          onClose={() => setCategoryManagerOpen(false)}
          onChanged={load} pushToast={pushToast}
        />
      )}

      <div className="ops-toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div className={`ops-toast ops-toast-${t.type}`} key={t.id}>{t.type === 'success' ? <Check size={15} /> : <AlertTriangle size={15} />} {t.message}</div>)}
      </div>
    </AppShell>
  )
}

function MenuItemCard({ item, view, busy, selected, onToggleSelect, menuOpen, onToggleMenu, onView, onEdit, onToggleAvailability, onDuplicate, onArchive }) {
  const reason = item.unavailableReason ? REASON_META[item.unavailableReason] : null
  const customizable = item.allowIce || item.allowSugar || item.allowAddons || item.temperatureType === 'flexible'
  return (
    <article className={`menu-item-card ${view === 'list' ? 'list' : ''}`}>
      <label className="menu-card-select"><input type="checkbox" checked={selected} onChange={onToggleSelect} aria-label={`Select ${item.name}`} /></label>
      <div className="menu-card-media"><img src={item.image} alt={item.name} loading="lazy" />
        <div className="inv-overflow menu-card-kebab">
          <button type="button" className="ops-icon-button small" aria-label={`More actions for ${item.name}`} aria-expanded={menuOpen} onClick={onToggleMenu}><MoreVertical size={15} /></button>
          {menuOpen && (
            <div className="inv-overflow-menu" role="menu">
              <button type="button" role="menuitem" onClick={onView}><Eye size={14} /> View details</button>
              <button type="button" role="menuitem" onClick={onDuplicate}><Copy size={14} /> Duplicate item</button>
              <button type="button" role="menuitem" className="danger" onClick={onArchive}><Archive size={14} /> Archive item</button>
            </div>
          )}
        </div>
      </div>
      <div className="menu-card-body">
        <p className="menu-card-eyebrow">{item.mainCategory}{item.subcategory ? ` · ${item.subcategory}` : ''}</p>
        <div className="menu-card-title-row">
          <b>{item.name}</b>
          {item.isBestseller && <span className="menu-badge tone-gold" title="Bestseller"><Star size={12} /></span>}
          {item.isFeatured && <span className="menu-badge tone-blue" title="Featured"><TrendingUp size={12} /></span>}
        </div>
        <p className="menu-card-desc">{item.description || 'No description yet.'}</p>
        <p className="menu-card-price">{money(item.price)}</p>
        <div className="menu-card-badges">
          <span className={`inv-status tone-${item.available ? 'green' : 'red'}`}>{item.available ? 'Available' : 'Unavailable'}</span>
          {customizable && <span className="inv-status tone-blue">{item.temperatureType === 'iced_only' ? 'Iced only' : item.temperatureType === 'hot_only' ? 'Hot only' : 'Flexible'}</span>}
          {!item.available && reason && <span className="menu-badge-warning"><AlertTriangle size={13} /> {reason.label}</span>}
        </div>
        <p className="menu-card-meta">Updated {timeAgo(item.updatedAt)}</p>
        <div className="menu-card-actions">
          <button type="button" className="ops-secondary-action" onClick={onEdit} disabled={busy}><Pencil size={14} /> Edit</button>
          <button type="button" className={item.manualAvailable ? 'ops-destructive-action' : 'ops-secondary-action'} onClick={onToggleAvailability} disabled={busy}>{item.manualAvailable ? 'Mark Unavailable' : 'Mark Available'}</button>
        </div>
      </div>
    </article>
  )
}

function ItemDrawer({ item, onClose, onEdit, onToggleAvailability }) {
  const [recipe, setRecipe] = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    let active = true
    fetchMenuItemRecipe(item.id).then((r) => { if (active) setRecipe(r) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [item.id])
  const reason = item.unavailableReason ? REASON_META[item.unavailableReason] : null
  return (
    <div className="ops-drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="ops-drawer" role="dialog" aria-modal="true" aria-labelledby="menu-drawer-title">
        <header><div><span className="settings-kicker">{item.mainCategory}</span><h2 id="menu-drawer-title">{item.name}</h2></div><button type="button" onClick={onClose} aria-label="Close item details"><X size={20} /></button></header>
        <div className="ops-drawer-body">
          <section><h3>Overview</h3>
            <p><b>{money(item.price)}</b> <span className={`inv-status tone-${item.available ? 'green' : 'red'}`}>{item.available ? 'Available' : 'Unavailable'}</span></p>
            {!item.available && reason && <p className="menu-badge-warning"><AlertTriangle size={13} /> {reason.label}</p>}
            <p>{item.description || 'No description yet.'}</p>
          </section>
          <section><h3>Details</h3>
            <p>Category: {item.mainCategory} · {item.subcategory || '—'}</p>
            <p>Type: {item.itemType}</p>
            <p>Temperature: {TEMP_LABEL[item.temperatureType]}</p>
            {item.prepTimeMinutes ? <p>Prep time: {item.prepTimeMinutes} min</p> : null}
            {(item.availableFrom || item.availableUntil) && <p>Scheduled: {item.availableFrom || '—'} to {item.availableUntil || '—'}</p>}
          </section>
          <section><h3>Recipe</h3>
            {loading ? <p className="ops-proof-pending">Loading…</p> : recipe.length === 0 ? <p className="ops-proof-pending">No recipe linked yet.</p> : (
              <ul className="inv-movement-list">{recipe.map((r) => <li key={r.ingredient_id}><b>{r.quantity_per_serving}</b> per serving</li>)}</ul>
            )}
          </section>
        </div>
        <footer className="ops-drawer-footer">
          <button type="button" className="ops-main-action" onClick={onEdit}><Pencil size={16} /> Edit</button>
          <button type="button" className="ops-secondary-action" onClick={onToggleAvailability}>{item.manualAvailable ? 'Mark Unavailable' : 'Mark Available'}</button>
        </footer>
      </aside>
    </div>
  )
}

function ItemFormModal({ item, mainCategories, subcategories, onClose, onSave }) {
  const [values, setValues] = useState({
    name: item?.name || '', description: item?.description || '', mainCategoryId: item?.mainCategoryId || mainCategories[0]?.id || '',
    subcategoryId: item?.subcategoryId || '', price: item?.price ?? '', itemType: item?.itemType || 'food', temperatureType: item?.temperatureType || 'none',
    allowIce: item?.allowIce ?? false, allowSugar: item?.allowSugar ?? false, allowAddons: item?.allowAddons ?? false,
    imageUrl: item?.imageUrl || '', manualAvailable: item?.manualAvailable ?? true, isFeatured: item?.isFeatured ?? false, isBestseller: item?.isBestseller ?? false,
    prepTimeMinutes: item?.prepTimeMinutes ?? '', availableFrom: item?.availableFrom || '', availableUntil: item?.availableUntil || '', sortOrder: item?.sortOrder ?? 0,
  })
  const [imagePreview, setImagePreview] = useState(item?.image || '')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)
  const set = (key, value) => setValues((c) => ({ ...c, [key]: value }))

  const availableSubcategories = useMemo(() => subcategories.filter((s) => !s.is_archived && s.main_category_id === values.mainCategoryId), [subcategories, values.mainCategoryId])

  const handleFile = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setUploading(true); setError('')
    try {
      const url = await uploadMenuItemImage(file)
      set('imageUrl', url)
      setImagePreview(url)
    } catch (cause) {
      setError(describeError(cause, 'Could not upload the image.'))
    } finally {
      setUploading(false)
    }
  }

  const submit = async (event) => {
    event.preventDefault()
    if (!values.name.trim()) return setError('Item name is required.')
    const price = Number(values.price)
    if (Number.isNaN(price) || price < 0) return setError('Price must be zero or greater.')
    if (values.availableFrom && values.availableUntil && values.availableFrom > values.availableUntil) return setError('Available-from date must be before the available-until date.')
    setSaving(true); setError('')
    try {
      await onSave({ id: item?.id, ...values, price, prepTimeMinutes: values.prepTimeMinutes === '' ? null : Number(values.prepTimeMinutes) })
    } catch (cause) {
      setError(describeError(cause, 'Could not save this item.'))
      setSaving(false)
    }
  }

  return (
    <div className="payment-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose() }}>
      <section className="payment-modal inv-form-modal menu-form-modal" role="dialog" aria-modal="true" aria-labelledby="menu-form-title">
        <button className="payment-modal-close" type="button" onClick={onClose} disabled={saving} aria-label="Close">×</button>
        <span className="payment-modal-kicker">{item ? 'Edit Item' : 'New Item'}</span>
        <h2 id="menu-form-title">{item ? item.name : 'Add a new menu item'}</h2>
        <form onSubmit={submit}>
          <div className="menu-image-upload">
            {imagePreview ? <img src={imagePreview} alt="Preview" /> : <div className="menu-image-placeholder"><ImagePlus size={22} /></div>}
            <div>
              <button type="button" className="ops-secondary-action compact" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? 'Uploading…' : 'Upload image'}</button>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={handleFile} />
              <p className="menu-image-hint">JPG, PNG, or WEBP. Max 5MB.</p>
            </div>
          </div>
          <div className="form-grid">
            <label className="field"><span>Item name</span><input value={values.name} onChange={(e) => set('name', e.target.value)} required /></label>
            <label className="field"><span>Base price (PHP)</span><input type="number" min="0" step="0.01" value={values.price} onChange={(e) => set('price', e.target.value)} required /></label>
            <label className="field"><span>Main category</span>
              <select value={values.mainCategoryId} onChange={(e) => { set('mainCategoryId', e.target.value); set('subcategoryId', '') }}>
                {mainCategories.filter((c) => !c.is_archived).map((c) => <option key={c.id} value={c.id}>{c.display_name || c.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Subcategory</span>
              <select value={values.subcategoryId} onChange={(e) => set('subcategoryId', e.target.value)}>
                <option value="">None</option>
                {availableSubcategories.map((s) => <option key={s.id} value={s.id}>{s.display_name || s.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Item type</span>
              <select value={values.itemType} onChange={(e) => set('itemType', e.target.value)}>
                <option value="drink">Drink</option><option value="food">Food</option>
              </select>
            </label>
            <label className="field"><span>Temperature</span>
              <select value={values.temperatureType} onChange={(e) => set('temperatureType', e.target.value)}>
                <option value="none">None</option><option value="hot_only">Hot only</option><option value="iced_only">Iced only</option><option value="flexible">Flexible (hot or iced)</option>
              </select>
            </label>
            <label className="field"><span>Prep time (minutes)</span><input type="number" min="0" value={values.prepTimeMinutes} onChange={(e) => set('prepTimeMinutes', e.target.value)} /></label>
            <label className="field"><span>Display order</span><input type="number" value={values.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} /></label>
            <label className="field"><span>Available from (optional)</span><input type="date" value={values.availableFrom} onChange={(e) => set('availableFrom', e.target.value)} /></label>
            <label className="field"><span>Available until (optional)</span><input type="date" value={values.availableUntil} onChange={(e) => set('availableUntil', e.target.value)} /></label>
          </div>
          <label className="field"><span>Description</span><textarea rows="3" value={values.description} onChange={(e) => set('description', e.target.value)} /></label>
          <div className="menu-checkbox-row">
            <label><input type="checkbox" checked={values.manualAvailable} onChange={(e) => set('manualAvailable', e.target.checked)} /> Available</label>
            <label><input type="checkbox" checked={values.isFeatured} onChange={(e) => set('isFeatured', e.target.checked)} /> Featured</label>
            <label><input type="checkbox" checked={values.isBestseller} onChange={(e) => set('isBestseller', e.target.checked)} /> Bestseller</label>
            <label><input type="checkbox" checked={values.allowIce} onChange={(e) => set('allowIce', e.target.checked)} /> Ice levels</label>
            <label><input type="checkbox" checked={values.allowSugar} onChange={(e) => set('allowSugar', e.target.checked)} /> Sugar levels</label>
            <label><input type="checkbox" checked={values.allowAddons} onChange={(e) => set('allowAddons', e.target.checked)} /> Add-ons</label>
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="payment-modal-actions">
            <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button>
            <button className="primary-button" type="submit" disabled={saving || uploading}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

function CategoryManagerModal({ mainCategories, subcategories, onClose, onChanged, pushToast }) {
  const [tab, setTab] = useState('main')
  const [name, setName] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [parentId, setParentId] = useState(mainCategories[0]?.id || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const addMain = async (event) => {
    event.preventDefault()
    if (!name.trim()) return setError('Name is required.')
    setSaving(true); setError('')
    try {
      await upsertMainCategory({ name, displayName })
      setName(''); setDisplayName('')
      pushToast('success', 'Category saved.')
      await onChanged()
    } catch (cause) { setError(describeError(cause, 'Could not save category.')) } finally { setSaving(false) }
  }
  const addSub = async (event) => {
    event.preventDefault()
    if (!name.trim()) return setError('Name is required.')
    setSaving(true); setError('')
    try {
      await upsertSubcategory({ name, displayName, mainCategoryId: parentId || null })
      setName(''); setDisplayName('')
      pushToast('success', 'Subcategory saved.')
      await onChanged()
    } catch (cause) { setError(describeError(cause, 'Could not save subcategory.')) } finally { setSaving(false) }
  }
  const archive = async (fn, id, label) => {
    try { await fn(id); pushToast('success', `${label} archived.`); await onChanged() }
    catch (cause) { pushToast('error', describeError(cause, `Could not archive ${label.toLowerCase()}.`)) }
  }

  return (
    <div className="payment-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className="payment-modal inv-form-modal" role="dialog" aria-modal="true" aria-labelledby="category-manager-title">
        <button className="payment-modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
        <span className="payment-modal-kicker">Categories</span>
        <h2 id="category-manager-title">Manage Categories</h2>
        <div className="inv-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'main'} className={tab === 'main' ? 'active' : ''} onClick={() => setTab('main')}>Main Categories</button>
          <button type="button" role="tab" aria-selected={tab === 'sub'} className={tab === 'sub' ? 'active' : ''} onClick={() => setTab('sub')}>Subcategories</button>
        </div>
        <ul className="menu-category-list">
          {(tab === 'main' ? mainCategories : subcategories).filter((c) => !c.is_archived).map((c) => (
            <li key={c.id}>
              <span>{c.display_name || c.name}{tab === 'sub' && ` — under ${mainCategories.find((m) => m.id === c.main_category_id)?.display_name || '—'}`}</span>
              <button type="button" className="ops-destructive-action compact" onClick={() => archive(tab === 'main' ? archiveMainCategory : archiveSubcategory, c.id, c.display_name || c.name)}>Archive</button>
            </li>
          ))}
        </ul>
        <form onSubmit={tab === 'main' ? addMain : addSub}>
          <div className="form-grid">
            <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} required /></label>
            <label className="field"><span>Display name</span><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} /></label>
            {tab === 'sub' && (
              <label className="field"><span>Parent category</span>
                <select value={parentId} onChange={(e) => setParentId(e.target.value)}>
                  {mainCategories.filter((c) => !c.is_archived).map((c) => <option key={c.id} value={c.id}>{c.display_name || c.name}</option>)}
                </select>
              </label>
            )}
          </div>
          {error && <p className="form-error">{error}</p>}
          <div className="payment-modal-actions">
            <button className="secondary-button" type="button" onClick={onClose}>Close</button>
            <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : `Add ${tab === 'main' ? 'Category' : 'Subcategory'}`}</button>
          </div>
        </form>
      </section>
    </div>
  )
}
