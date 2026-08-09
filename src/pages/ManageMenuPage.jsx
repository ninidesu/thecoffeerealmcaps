import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Archive, Bell, Box, CalendarDays, Check, Copy, Eye, ExternalLink, Folder,
  Grid, ImagePlus, List, MoreVertical, Pencil, Plus, RefreshCw, Search, SlidersHorizontal, Star, Tags, TrendingUp, X,
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
import { shouldShowSystemNotification } from '../services/staffSettingsService'
import { useManagementSessionState } from '../hooks/useManagementSessionState'

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

  const [tab, setTab] = useManagementSessionState('staff:menu:tab', 'all')
  const [subcategoryFilter, setSubcategoryFilter] = useManagementSessionState('staff:menu:subcategory-filter', 'all')
  const [search, setSearch] = useManagementSessionState('staff:menu:search', '')
  const [customizableFilter, setCustomizableFilter] = useManagementSessionState('staff:menu:customizable-filter', 'all')
  const [minPrice, setMinPrice] = useManagementSessionState('staff:menu:min-price', '')
  const [maxPrice, setMaxPrice] = useManagementSessionState('staff:menu:max-price', '')
  const [sortBy, setSortBy] = useManagementSessionState('staff:menu:sort', 'name')
  const [view, setView] = useManagementSessionState('staff:menu:view', 'grid')
  const [selectedIds, setSelectedIds] = useManagementSessionState('staff:menu:selected-items', [])
  const [menuOpenId, setMenuOpenId] = useState('')

  const [formTarget, setFormTarget] = useManagementSessionState('staff:menu:item-form', null)
  const [drawerItem, setDrawerItem] = useManagementSessionState('staff:menu:drawer', null)
  const [availabilityTarget, setAvailabilityTarget] = useManagementSessionState('staff:menu:availability-confirmation', null)
  const [archiveTarget, setArchiveTarget] = useManagementSessionState('staff:menu:archive-confirmation', null)
  const [categoryManagerOpen, setCategoryManagerOpen] = useManagementSessionState('staff:menu:category-manager', false)

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
    if (!shouldShowSystemNotification(type)) return
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
      if (customizableFilter === 'customizable' && !(item.allowIce || item.allowSugar || item.allowAddons || item.temperatureType === 'flexible')) return false
      if (customizableFilter === 'fixed' && (item.allowIce || item.allowSugar || item.allowAddons || item.temperatureType === 'flexible')) return false
      if (min !== null && item.price < min) return false
      if (max !== null && item.price > max) return false
      return true
    })
  }, [items, tab, subcategoryFilter, search, customizableFilter, minPrice, maxPrice])

  const sorted = useMemo(() => {
    const list = [...filtered]
    if (sortBy === 'name') list.sort((a, b) => a.name.localeCompare(b.name))
    else if (sortBy === 'name-desc') list.sort((a, b) => b.name.localeCompare(a.name))
    else if (sortBy === 'most-ordered') list.sort((a, b) => b.orderCount - a.orderCount || a.name.localeCompare(b.name))
    else if (sortBy === 'least-ordered') list.sort((a, b) => a.orderCount - b.orderCount || a.name.localeCompare(b.name))
    else if (sortBy === 'lowest-price') list.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name))
    else if (sortBy === 'highest-price') list.sort((a, b) => b.price - a.price || a.name.localeCompare(b.name))
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
      setAvailabilityTarget(null)
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
    <AppShell role="staff" title="Manage Menu" onRefresh={load} actions={
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
      </div>
    }>
      {error && <p className="form-error">{error}</p>}

      <section className="inv-summary-row menu-summary-grid" aria-label="Menu overview">
        <article className="inv-summary-card menu-summary-card accent-green">
          <span className="menu-summary-copy"><span>Active Items</span><small>Catalog total</small></span>
          <strong>{activeItems.length}</strong>
        </article>
        <article className="inv-summary-card menu-summary-card accent-green">
          <span className="menu-summary-copy"><span>Drinks</span><small>Drink collection</small></span>
          <strong>{drinksCount}</strong>
        </article>
        <article className="inv-summary-card menu-summary-card accent-green">
          <span className="menu-summary-copy"><span>Foods</span><small>Food collection</small></span>
          <strong>{foodsCount}</strong>
        </article>
        <article className="inv-summary-card menu-summary-card accent-blue">
          <span className="menu-summary-copy"><span>Available</span><small>Ready for orders</small></span>
          <strong>{availableCount}</strong>
        </article>
        <article className="inv-summary-card menu-summary-card accent-gray">
          <span className="menu-summary-copy"><span>Unavailable</span><small>Needs attention</small></span>
          <strong>{unavailableCount}</strong>
        </article>
      </section>

      <div className="menu-manage-tools">
        <label className="menu-manage-search">
          <Search size={17} /><span className="sr-only">Search menu items</span>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search drinks, cakes, and meals..." />
          {search && <button type="button" className="menu-manage-search-clear" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}
        </label>
        <div className="menu-manage-chip-row" aria-label="Menu categories">
          <button type="button" aria-pressed={subcategoryFilter === 'all'} className={`menu-manage-chip ${subcategoryFilter === 'all' ? 'active' : ''}`} onClick={() => setSubcategoryFilter('all')}>All</button>
          {activeSubcategories.map((s) => (
            <button type="button" key={s.id} aria-pressed={subcategoryFilter === s.id} className={`menu-manage-chip ${subcategoryFilter === s.id ? 'active' : ''}`} onClick={() => setSubcategoryFilter(s.id)}>{s.display_name || s.name}</button>
          ))}
        </div>
      </div>

      <div className="menu-manage-toolbar">
        <div className="menu-toolbar-group menu-toolbar-main-actions">
          <button type="button" className="ops-secondary-action compact" onClick={() => setCategoryManagerOpen(true)}><Folder size={15} /> Manage Categories</button>
          <button type="button" className="ops-main-action compact menu-add-item-action" onClick={() => setFormTarget({ item: null })}><Plus size={15} /> Add Item</button>
          <span className="menu-filter-label" aria-hidden="true">Filters:</span>
          <label className="menu-sort-control">
            <span className="sr-only">Sort items</span>
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="name">Sort by: Ascending</option>
              <option value="name-desc">Sort by: Descending</option>
              <option value="most-ordered">Sort by: Most Ordered</option>
              <option value="least-ordered">Sort by: Least Ordered</option>
              <option value="lowest-price">Sort by: Lowest Price</option>
              <option value="highest-price">Sort by: Highest Price</option>
            </select>
          </label>
          <label className="menu-inline-filter menu-customizable-filter">
            <span className="sr-only">Filter by customization</span>
            <select value={customizableFilter} onChange={(e) => setCustomizableFilter(e.target.value)}>
              <option value="all">Customizable / fixed</option><option value="customizable">Customizable</option><option value="fixed">Fixed</option>
            </select>
          </label>
          <label className="menu-inline-filter menu-price-filter"><span className="sr-only">Minimum price</span><input type="number" min="0" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} placeholder="Min. price" /></label>
          <label className="menu-inline-filter menu-price-filter"><span className="sr-only">Maximum price</span><input type="number" min="0" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="Max price" /></label>
          <button type="button" className="menu-clear-filters" onClick={() => { setSortBy('name'); setCustomizableFilter('all'); setMinPrice(''); setMaxPrice('') }}>Clear</button>
        </div>
        <div className="menu-toolbar-group menu-toolbar-view-actions">
          <div className="menu-view-toggle" role="group" aria-label="Menu view">
            <button type="button" className={view === 'grid' ? 'active' : ''} aria-label="Grid view" aria-pressed={view === 'grid'} onClick={() => setView('grid')}><Grid size={16} /></button>
            <button type="button" className={view === 'list' ? 'active' : ''} aria-label="List view" aria-pressed={view === 'list'} onClick={() => setView('list')}><List size={16} /></button>
          </div>
          <a className="ops-secondary-action compact menu-preview-link" href="/menu" target="_blank" rel="noreferrer"><ExternalLink size={15} /> Preview as Customer</a>
        </div>
      </div>

      <div className="menu-status-row">
        <div className="inv-tabs" role="tablist" aria-label="Menu item status">
          {[['all', 'All Items'], ['available', 'Available Now'], ['unavailable', 'Unavailable'], ['archived', 'Archived']].map(([key, label]) => (
            <button type="button" key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => { setTab(key); clearSelection() }}>{label}</button>
          ))}
        </div>

        {selectedIds.length > 0 && (
          <div className="menu-bulk-bar" aria-live="polite">
            <span>{selectedIds.length} selected</span>
            <button type="button" className="ops-secondary-action compact" disabled={busyId === 'bulk'} onClick={() => runBulkAvailability(true)}>Mark Available</button>
            <button type="button" className="ops-secondary-action compact" disabled={busyId === 'bulk'} onClick={() => runBulkAvailability(false)}>Mark Unavailable</button>
            <button type="button" className="ops-secondary-action compact" onClick={clearSelection}>Clear</button>
          </div>
        )}
      </div>

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
              onToggleAvailability={() => setAvailabilityTarget(item)}
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
          onToggleAvailability={() => setAvailabilityTarget(drawerItem)}
        />
      )}
      {availabilityTarget && (
        <div
          className="payment-modal-backdrop ops-modal-backdrop"
          onMouseDown={(e) => { if (e.target === e.currentTarget && busyId !== availabilityTarget.id) setAvailabilityTarget(null) }}
          onKeyDown={(e) => { if (e.key === 'Escape' && busyId !== availabilityTarget.id) setAvailabilityTarget(null) }}
        >
          <section className="payment-modal ops-popup-modal menu-availability-modal" role="dialog" aria-modal="true" aria-labelledby="menu-availability-title" aria-describedby="menu-availability-description">
            <span className="payment-modal-kicker">Confirm availability</span>
            <h2 id="menu-availability-title">Mark {availabilityTarget.name} {availabilityTarget.manualAvailable ? 'unavailable' : 'available'}?</h2>
            <p id="menu-availability-description">
              {availabilityTarget.manualAvailable
                ? 'Customers will no longer be able to order this item until you make it available again.'
                : 'Customers will be able to see and order this item when its ingredients are in stock.'}
            </p>
            <div className="payment-modal-actions">
              <button className="secondary-button" type="button" autoFocus onClick={() => setAvailabilityTarget(null)} disabled={busyId === availabilityTarget.id}>Cancel</button>
              <button
                className={availabilityTarget.manualAvailable ? 'danger-button' : 'primary-button'}
                type="button"
                disabled={busyId === availabilityTarget.id}
                onClick={() => runToggleAvailability(availabilityTarget)}
              >
                {busyId === availabilityTarget.id
                  ? 'Updating…'
                  : availabilityTarget.manualAvailable ? 'Mark unavailable' : 'Mark available'}
              </button>
            </div>
          </section>
        </div>
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
  const draftScope = `staff:menu:${item?.id || 'new'}:draft`
  const [values, setValues, clearValues] = useManagementSessionState(`${draftScope}:values`, {
    name: item?.name || '', description: item?.description || '', mainCategoryId: item?.mainCategoryId || mainCategories[0]?.id || '',
    subcategoryId: item?.subcategoryId || '', price: item?.price ?? '', itemType: item?.itemType || 'food', temperatureType: item?.temperatureType || 'none',
    allowIce: item?.allowIce ?? false, allowSugar: item?.allowSugar ?? false, allowAddons: item?.allowAddons ?? false,
    imageUrl: item?.imageUrl || '', manualAvailable: item?.manualAvailable ?? true, isFeatured: item?.isFeatured ?? false, isBestseller: item?.isBestseller ?? false,
    prepTimeMinutes: item?.prepTimeMinutes ?? '', availableFrom: item?.availableFrom || '', availableUntil: item?.availableUntil || '', sortOrder: item?.sortOrder ?? 0,
  })
  const [imagePreview, setImagePreview, clearImagePreview] = useManagementSessionState(`${draftScope}:image`, item?.image || '')
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [section, setSection, clearSection] = useManagementSessionState(`${draftScope}:section`, 'basics')
  const fileRef = useRef(null)
  const set = (key, value) => setValues((c) => ({ ...c, [key]: value }))
  const close = () => { clearValues(); clearImagePreview(); clearSection(); onClose() }

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
    if (!values.name.trim()) { setSection('basics'); return setError('Item name is required.') }
    const price = Number(values.price)
    if (Number.isNaN(price) || price < 0) { setSection('basics'); return setError('Price must be zero or greater.') }
    if (values.availableFrom && values.availableUntil && values.availableFrom > values.availableUntil) { setSection('scheduling'); return setError('Available-from date must be before the available-until date.') }
    setSaving(true); setError('')
    try {
      await onSave({ id: item?.id, ...values, price, prepTimeMinutes: values.prepTimeMinutes === '' ? null : Number(values.prepTimeMinutes) })
      clearValues(); clearImagePreview(); clearSection()
    } catch (cause) {
      setError(describeError(cause, 'Could not save this item.'))
      setSaving(false)
    }
  }

  return (
    <div className="payment-modal-backdrop ops-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) close() }} onKeyDown={(e) => { if (e.key === 'Escape' && !saving) close() }}>
      <section className="payment-modal inv-form-modal menu-form-modal menu-workspace-modal ops-popup-modal" role="dialog" aria-modal="true" aria-labelledby="menu-form-title">
        <button className="payment-modal-close" type="button" onClick={close} disabled={saving} aria-label="Close item editor"><X size={18} /></button>
        <header className="menu-workspace-header">
          <span className="payment-modal-kicker">{item ? 'Edit menu item' : 'New menu item'}</span>
          <h2 id="menu-form-title">{item ? item.name : 'Add a new menu item'}</h2>
          <p>Move through each section to organize the item details, customer options, and availability.</p>
        </header>
        <form className="menu-editor-form" onSubmit={submit}>
          <div className="menu-editor-layout">
            <nav className="menu-editor-nav" role="tablist" aria-label="Item editor sections">
              <button type="button" role="tab" aria-selected={section === 'basics'} aria-controls="menu-editor-basics" className={section === 'basics' ? 'active' : ''} onClick={() => setSection('basics')}><ImagePlus size={18} /><span><b>Basics</b><small>Name, image, and category</small></span></button>
              <button type="button" role="tab" aria-selected={section === 'options'} aria-controls="menu-editor-options" className={section === 'options' ? 'active' : ''} onClick={() => setSection('options')}><SlidersHorizontal size={18} /><span><b>Options</b><small>Availability and choices</small></span></button>
              <button type="button" role="tab" aria-selected={section === 'scheduling'} aria-controls="menu-editor-scheduling" className={section === 'scheduling' ? 'active' : ''} onClick={() => setSection('scheduling')}><CalendarDays size={18} /><span><b>Scheduling</b><small>Timing and display order</small></span></button>
            </nav>
            <div className="menu-editor-panel">
              {section === 'basics' && (
                <section id="menu-editor-basics" role="tabpanel" className="menu-form-section" aria-label="Basic item details">
                  <header><h3>Basic details</h3><p>The information customers use to identify this item.</p></header>
                  <div className="menu-image-upload menu-image-upload-card">
                    {imagePreview ? <img src={imagePreview} alt={`${values.name || 'Menu item'} preview`} /> : <div className="menu-image-placeholder"><ImagePlus size={24} /></div>}
                    <div><b>Menu photo</b><p>Use a clear square image. JPG, PNG, or WEBP up to 5MB.</p><button type="button" className="ops-secondary-action compact" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? 'Uploading…' : imagePreview ? 'Replace image' : 'Upload image'}</button><input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={handleFile} /></div>
                  </div>
                  <div className="form-grid menu-form-grid">
                    <label className="field"><span>Item name</span><input autoFocus value={values.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Spanish Latte" required /></label>
                    <label className="field"><span>Base price (PHP)</span><input type="number" min="0" step="0.01" value={values.price} onChange={(e) => set('price', e.target.value)} placeholder="0.00" required /></label>
                    <label className="field"><span>Main category</span><select value={values.mainCategoryId} onChange={(e) => { set('mainCategoryId', e.target.value); set('subcategoryId', '') }}>{mainCategories.filter((c) => !c.is_archived).map((c) => <option key={c.id} value={c.id}>{c.display_name || c.name}</option>)}</select></label>
                    <label className="field"><span>Subcategory</span><select value={values.subcategoryId} onChange={(e) => set('subcategoryId', e.target.value)}><option value="">No subcategory</option>{availableSubcategories.map((s) => <option key={s.id} value={s.id}>{s.display_name || s.name}</option>)}</select></label>
                    <label className="field"><span>Item type</span><select value={values.itemType} onChange={(e) => set('itemType', e.target.value)}><option value="drink">Drink</option><option value="food">Food</option></select></label>
                  </div>
                  <label className="field menu-description-field"><span>Description</span><textarea rows="3" value={values.description} onChange={(e) => set('description', e.target.value)} placeholder="Describe the flavor, ingredients, or serving style." /></label>
                </section>
              )}
              {section === 'options' && (
                <section id="menu-editor-options" role="tabpanel" className="menu-form-section" aria-label="Item options">
                  <header><h3>Availability and options</h3><p>Choose how this item appears and what customers can customize.</p></header>
                  <label className="field menu-temperature-field"><span>Temperature</span><select value={values.temperatureType} onChange={(e) => set('temperatureType', e.target.value)}><option value="none">Not applicable</option><option value="hot_only">Hot only</option><option value="iced_only">Iced only</option><option value="flexible">Hot or iced</option></select><small>This controls which temperature choices customers see.</small></label>
                  <fieldset className="menu-option-group"><legend>Menu status</legend><div className="menu-option-grid">
                    <label className="menu-option-card"><input type="checkbox" checked={values.manualAvailable} onChange={(e) => set('manualAvailable', e.target.checked)} /><span><b>Available</b><small>Customers can order this item.</small></span></label>
                    <label className="menu-option-card"><input type="checkbox" checked={values.isFeatured} onChange={(e) => set('isFeatured', e.target.checked)} /><span><b>Featured</b><small>Give the item extra visibility.</small></span></label>
                    <label className="menu-option-card"><input type="checkbox" checked={values.isBestseller} onChange={(e) => set('isBestseller', e.target.checked)} /><span><b>Bestseller</b><small>Show the bestseller marker.</small></span></label>
                  </div></fieldset>
                  <fieldset className="menu-option-group"><legend>Customer customization</legend><div className="menu-option-grid">
                    <label className="menu-option-card"><input type="checkbox" checked={values.allowIce} onChange={(e) => set('allowIce', e.target.checked)} /><span><b>Ice levels</b><small>Let customers choose ice amount.</small></span></label>
                    <label className="menu-option-card"><input type="checkbox" checked={values.allowSugar} onChange={(e) => set('allowSugar', e.target.checked)} /><span><b>Sugar levels</b><small>Let customers adjust sweetness.</small></span></label>
                    <label className="menu-option-card"><input type="checkbox" checked={values.allowAddons} onChange={(e) => set('allowAddons', e.target.checked)} /><span><b>Add-ons</b><small>Allow compatible extras.</small></span></label>
                  </div></fieldset>
                </section>
              )}
              {section === 'scheduling' && (
                <section id="menu-editor-scheduling" role="tabpanel" className="menu-form-section" aria-label="Item scheduling">
                  <header><h3>Scheduling and order</h3><p>Control preparation guidance, menu position, and optional selling dates.</p></header>
                  <div className="form-grid menu-form-grid">
                    <label className="field"><span>Prep time (minutes)</span><input type="number" min="0" value={values.prepTimeMinutes} onChange={(e) => set('prepTimeMinutes', e.target.value)} placeholder="e.g. 10" /><small>Used by staff as preparation guidance.</small></label>
                    <label className="field"><span>Display order</span><input type="number" value={values.sortOrder} onChange={(e) => set('sortOrder', e.target.value)} /><small>Lower numbers appear first.</small></label>
                  </div>
                  <div className="menu-schedule-card"><div><CalendarDays size={18} /><span><b>Optional selling window</b><small>Leave both dates empty to keep the item available year-round.</small></span></div><div className="form-grid menu-form-grid"><label className="field"><span>Available from</span><input type="date" value={values.availableFrom} onChange={(e) => set('availableFrom', e.target.value)} /></label><label className="field"><span>Available until</span><input type="date" value={values.availableUntil} onChange={(e) => set('availableUntil', e.target.value)} /></label></div></div>
                </section>
              )}
            </div>
          </div>
          {error && <p className="form-error menu-workspace-error" role="alert">{error}</p>}
          <div className="payment-modal-actions menu-workspace-actions"><button className="secondary-button" type="button" onClick={close} disabled={saving}>Cancel</button><button className="primary-button" type="submit" disabled={saving || uploading}>{saving ? 'Saving…' : item ? 'Save changes' : 'Add item'}</button></div>
        </form>
      </section>
    </div>
  )
}

function CategoryManagerModal({ mainCategories, subcategories, onClose, onChanged, pushToast }) {
  const [tab, setTab, clearTab] = useManagementSessionState('staff:menu:category-draft:tab', 'main')
  const [name, setName, clearName] = useManagementSessionState('staff:menu:category-draft:name', '')
  const [displayName, setDisplayName, clearDisplayName] = useManagementSessionState('staff:menu:category-draft:display-name', '')
  const [parentId, setParentId, clearParentId] = useManagementSessionState('staff:menu:category-draft:parent', mainCategories.find((category) => !category.is_archived)?.id || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const close = () => { clearTab(); clearName(); clearDisplayName(); clearParentId(); onClose() }

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

  const activeMainCategories = mainCategories.filter((category) => !category.is_archived)
  const activeSubcategories = subcategories.filter((category) => !category.is_archived)
  const visibleCategories = tab === 'main' ? activeMainCategories : activeSubcategories
  const changeTab = (nextTab) => { setTab(nextTab); setError(''); setName(''); setDisplayName('') }

  return (
    <div className="payment-modal-backdrop ops-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) close() }} onKeyDown={(e) => { if (e.key === 'Escape' && !saving) close() }}>
      <section className="payment-modal inv-form-modal category-workspace-modal ops-popup-modal" role="dialog" aria-modal="true" aria-labelledby="category-manager-title">
        <button className="payment-modal-close" type="button" onClick={close} disabled={saving} aria-label="Close category manager"><X size={18} /></button>
        <header className="menu-workspace-header">
          <span className="payment-modal-kicker">Menu organization</span>
          <h2 id="category-manager-title">Categories and subcategories</h2>
          <p>Organize the customer menu into broad groups, then use subcategories for easier browsing.</p>
        </header>
        <nav className="category-workspace-tabs" role="tablist" aria-label="Category type">
          <button type="button" role="tab" aria-selected={tab === 'main'} aria-controls="category-main-panel" className={tab === 'main' ? 'active' : ''} onClick={() => changeTab('main')}><Folder size={18} /><span><b>Main categories</b><small>Top-level menu groups</small></span><strong>{activeMainCategories.length}</strong></button>
          <button type="button" role="tab" aria-selected={tab === 'sub'} aria-controls="category-sub-panel" className={tab === 'sub' ? 'active' : ''} onClick={() => changeTab('sub')}><Tags size={18} /><span><b>Subcategories</b><small>Groups inside categories</small></span><strong>{activeSubcategories.length}</strong></button>
        </nav>
        <div className="category-workspace-grid" id={tab === 'main' ? 'category-main-panel' : 'category-sub-panel'} role="tabpanel">
          <section className="category-list-panel">
            <header><div><h3>{tab === 'main' ? 'Main categories' : 'Subcategories'}</h3><p>{visibleCategories.length} active {visibleCategories.length === 1 ? 'group' : 'groups'}</p></div></header>
            {visibleCategories.length === 0 ? (
              <div className="category-empty-state"><Tags size={24} /><b>No {tab === 'main' ? 'categories' : 'subcategories'} yet</b><p>Use the form beside this list to create the first one.</p></div>
            ) : (
              <ul className="menu-category-list category-workspace-list">
                {visibleCategories.map((category) => {
                  const parent = mainCategories.find((main) => main.id === category.main_category_id)
                  return (
                    <li key={category.id}>
                      <span className="category-row-icon" aria-hidden="true">{tab === 'main' ? <Folder size={17} /> : <Tags size={17} />}</span>
                      <span className="category-row-copy"><b>{category.display_name || category.name}</b><small>{tab === 'sub' ? `Under ${parent?.display_name || parent?.name || 'Unassigned'}` : `Internal name: ${category.name}`}</small></span>
                      <button type="button" className="ops-destructive-action compact" onClick={() => archive(tab === 'main' ? archiveMainCategory : archiveSubcategory, category.id, category.display_name || category.name)}>Archive</button>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
          <aside className="category-create-panel">
            <header><span><Plus size={18} /></span><div><h3>Add {tab === 'main' ? 'a main category' : 'a subcategory'}</h3><p>{tab === 'main' ? 'Create a broad menu group such as Drinks or Foods.' : 'Create a focused group such as Espresso or Cakes.'}</p></div></header>
            <form onSubmit={tab === 'main' ? addMain : addSub}>
              {tab === 'sub' && <label className="field"><span>Parent category</span><select value={parentId} onChange={(e) => setParentId(e.target.value)} required>{activeMainCategories.map((category) => <option key={category.id} value={category.id}>{category.display_name || category.name}</option>)}</select><small>Where this subcategory will appear.</small></label>}
              <label className="field"><span>Internal name</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder={tab === 'main' ? 'e.g. drinks' : 'e.g. espresso'} required /><small>Use a short, unique system name.</small></label>
              <label className="field"><span>Customer-facing name</span><input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={tab === 'main' ? 'e.g. Drinks' : 'e.g. Espresso'} /><small>Optional. Falls back to the internal name.</small></label>
              {error && <p className="form-error" role="alert">{error}</p>}
              <button className="primary-button category-add-button" type="submit" disabled={saving || (tab === 'sub' && activeMainCategories.length === 0)}>{saving ? 'Saving…' : `Add ${tab === 'main' ? 'category' : 'subcategory'}`}</button>
            </form>
          </aside>
        </div>
      </section>
    </div>
  )
}
