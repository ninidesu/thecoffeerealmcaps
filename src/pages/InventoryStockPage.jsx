import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, Archive, ArrowDown, ArrowUp, Bell, Box, Check, ChefHat, ChevronDown, ChevronRight,
  ClipboardList, Clock3, Filter, History, Link2, ListChecks, MoreVertical, Package, PackageMinus,
  PackagePlus, PackageX, Pencil, Plus, RefreshCw, Search, ShoppingBag, Truck, Utensils, X, Zap,
} from 'lucide-react'
import AppShell from '../components/AppShell'
import { describeError } from '../utils/describeError'
import { supabase } from '../lib/supabase'
import {
  fetchIngredients, fetchFinishedProducts, fetchSupplies, fetchMenuItemOptions,
  fetchMovements, fetchRecipeMatrix, fetchRecentActivity, fetchSupplyMatrix, setMenuItemSupplies,
  upsertIngredient, archiveIngredient, upsertFinishedProduct, archiveFinishedProduct,
  upsertSupply, archiveSupply, adjustStock,
} from '../services/opsInventoryService'
import { fetchMenuItemRecipe, setMenuItemRecipe } from '../services/manageMenuService'

const ENTITY_CONFIGS = {
  ingredient: { key: 'ingredient', label: 'Ingredients', singular: 'Ingredient', upsert: upsertIngredient, archive: archiveIngredient, hasType: true },
  finished_product: { key: 'finished_product', label: 'Finished Products', singular: 'Finished Product', upsert: upsertFinishedProduct, archive: archiveFinishedProduct, hasType: false, hasMenuLink: true },
  supply: { key: 'supply', label: 'Supplies', singular: 'Supply', upsert: upsertSupply, archive: archiveSupply, hasType: false },
}
const TABS = [ENTITY_CONFIGS.ingredient, ENTITY_CONFIGS.finished_product, ENTITY_CONFIGS.supply]

const VIEW_TABS = [
  ['inventory', 'Inventory', Package],
  ['recipes', 'Product Recipes', ChefHat],
  ['unmapped', 'Unmapped Records', Link2],
  ['activity', 'Recent Activity', History],
]

function stockStatus(item) {
  if (item.isArchived) return 'inactive'
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
  inactive: { label: 'Inactive', tone: 'neutral' },
}
// Supplies use plain retail wording rather than the kitchen-stock wording
// the ingredient tabs use.
const SUPPLY_STATUS_LABEL = { healthy: 'In Stock', over: 'In Stock' }
const statusLabel = (entity, key) =>
  (entity === 'supply' && SUPPLY_STATUS_LABEL[key]) || STATUS_META[key].label

const TEMP_LABEL = { hot: 'Hot', iced: 'Iced' }
const SERVICE_LABEL = { dine_in: 'Dine-in', takeout: 'Takeout' }
function conditionLabel(link) {
  const parts = []
  if (link.temperature) parts.push(TEMP_LABEL[link.temperature] || link.temperature)
  if (link.service) parts.push(SERVICE_LABEL[link.service] || link.service)
  return parts.length ? parts.join(' · ') : 'Always'
}
const MOVEMENT_META = {
  restock: { label: 'Stock In', tone: 'green', sign: '+' },
  deduction: { label: 'Deduction', tone: 'amber', sign: '−' },
  adjustment: { label: 'Adjustment', tone: 'blue', sign: '±' },
  waste: { label: 'Waste', tone: 'red', sign: '−' },
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
  const navigate = useNavigate()
  const [view, setView] = useState('inventory')
  const [activeEntity, setActiveEntity] = useState('ingredient')
  const [data, setData] = useState({ ingredient: [], finished_product: [], supply: [] })
  const [menuItems, setMenuItems] = useState([])
  const [recipeMatrix, setRecipeMatrix] = useState({ links: [], menuItems: [] })
  const [supplyLinks, setSupplyLinks] = useState([])
  const [activity, setActivity] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [lastUpdated, setLastUpdated] = useState(null)
  const [now, setNow] = useState(() => new Date())
  const [busyId, setBusyId] = useState('')
  const [toasts, setToasts] = useState([])

  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('name')
  const [sortDir, setSortDir] = useState('asc')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [moreOpen, setMoreOpen] = useState(false)
  const [moreFilters, setMoreFilters] = useState({ type: 'all', unit: 'all', supplier: 'all', mapping: 'all' })
  const [menuOpenId, setMenuOpenId] = useState('')
  const [quickOpen, setQuickOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)

  const [mapMode, setMapMode] = useState('product')
  const [mapSearch, setMapSearch] = useState('')
  const [mapCategory, setMapCategory] = useState('all')
  const [mapStatus, setMapStatus] = useState('all')
  const [expandedMapId, setExpandedMapId] = useState('')

  const [formTarget, setFormTarget] = useState(null)
  const [drawerItem, setDrawerItem] = useState(null)
  const [adjustTarget, setAdjustTarget] = useState(null)
  const [archiveTarget, setArchiveTarget] = useState(null)
  const [recipeTarget, setRecipeTarget] = useState(null)
  const [pickerTarget, setPickerTarget] = useState(null)

  const config = ENTITY_CONFIGS[activeEntity]
  const loadingRef = useRef(false)

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(t) }, [])

  const load = async ({ silent = false } = {}) => {
    if (loadingRef.current) return
    loadingRef.current = true
    if (!silent) setLoading(true)
    try {
      const [ingredients, finished, supplies, menuOptions, matrix, feed, supplyMatrix] = await Promise.all([
        fetchIngredients(), fetchFinishedProducts(), fetchSupplies(), fetchMenuItemOptions(),
        fetchRecipeMatrix(), fetchRecentActivity(), fetchSupplyMatrix(),
      ])
      setData({ ingredient: ingredients, finished_product: finished, supply: supplies })
      setMenuItems(menuOptions)
      setRecipeMatrix(matrix)
      setActivity(feed)
      setSupplyLinks(supplyMatrix)
      setLastUpdated(new Date())
      setError('')
    } catch (cause) {
      setError(describeError(cause, 'Could not load inventory.'))
    } finally {
      loadingRef.current = false
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  useEffect(() => {
    const refresh = () => load({ silent: true })
    const channel = supabase
      .channel('staff-inventory-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_stock' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'inventory_movements' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'finished_products' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'supplies' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_item_ingredients' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'supply_movements' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_item_supplies' }, refresh)
      .subscribe()
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { supabase.removeChannel(channel); document.removeEventListener('visibilitychange', onVisible) }
  }, [])

  useEffect(() => {
    setSearch(''); setCategoryFilter('all'); setStatusFilter('all')
    setMoreFilters({ type: 'all', unit: 'all', supplier: 'all', mapping: 'all' })
    setPage(1); setMoreOpen(false)
  }, [activeEntity])

  const pushToast = (type, message) => {
    const id = crypto.randomUUID()
    setToasts((c) => [...c, { id, type, message }])
    setTimeout(() => setToasts((c) => c.filter((t) => t.id !== id)), 4500)
  }

  // ---- Recipe mapping derivations -----------------------------------------
  const ingredientById = useMemo(() => new Map(data.ingredient.map((i) => [i.id, i])), [data.ingredient])
  const menuItemsById = useMemo(() => new Map(recipeMatrix.menuItems.map((m) => [m.id, m])), [recipeMatrix.menuItems])

  const linksByProduct = useMemo(() => {
    const map = new Map()
    recipeMatrix.links.forEach((link) => {
      if (!map.has(link.menuItemId)) map.set(link.menuItemId, [])
      map.get(link.menuItemId).push(link)
    })
    return map
  }, [recipeMatrix.links])

  const linksByIngredient = useMemo(() => {
    const map = new Map()
    recipeMatrix.links.forEach((link) => {
      if (!map.has(link.ingredientId)) map.set(link.ingredientId, [])
      map.get(link.ingredientId).push(link)
    })
    return map
  }, [recipeMatrix.links])

  const supplyById = useMemo(() => new Map(data.supply.map((s) => [s.id, s])), [data.supply])
  const supplyLinksByProduct = useMemo(() => {
    const map = new Map()
    supplyLinks.forEach((link) => {
      const key = link.menuItemId || '__order__'
      if (!map.has(key)) map.set(key, [])
      map.get(key).push(link)
    })
    return map
  }, [supplyLinks])
  const supplyLinksBySupply = useMemo(() => {
    const map = new Map()
    supplyLinks.forEach((link) => {
      if (!map.has(link.supplyId)) map.set(link.supplyId, [])
      map.get(link.supplyId).push(link)
    })
    return map
  }, [supplyLinks])

  const validation = useMemo(() => {
    const productsWithoutRecipe = recipeMatrix.menuItems.filter((m) => !(linksByProduct.get(m.id)?.length))
    const unusedIngredients = data.ingredient.filter((i) => !(linksByIngredient.get(i.id)?.length))
    const invalidQtyLinks = recipeMatrix.links.filter((link) => link.quantityPerServing == null || link.quantityPerServing <= 0)
    const inactiveLinks = recipeMatrix.links.filter((link) => !ingredientById.has(link.ingredientId) && menuItemsById.get(link.menuItemId)?.isAvailable)
    const unitMissing = data.ingredient.filter((i) => !i.unit || i.unit === 'unit')
    const incompleteProductIds = new Set(invalidQtyLinks.map((l) => l.menuItemId).concat(inactiveLinks.map((l) => l.menuItemId)))
    return { productsWithoutRecipe, unusedIngredients, invalidQtyLinks, inactiveLinks, unitMissing, incompleteProductIds }
  }, [recipeMatrix, linksByProduct, linksByIngredient, ingredientById, menuItemsById, data.ingredient])

  const outIngredients = useMemo(() => data.ingredient.filter((i) => stockStatus(i) === 'out'), [data.ingredient])

  const warnings = useMemo(() => {
    const list = []
    outIngredients.forEach((ingredient) => {
      const affected = (linksByIngredient.get(ingredient.id) || [])
        .map((link) => menuItemsById.get(link.menuItemId)?.name)
        .filter(Boolean)
      list.push({
        key: `out-${ingredient.id}`, tone: 'red',
        text: `${ingredient.name} is out of stock`,
        detail: affected.length ? `Affected products: ${affected.join(', ')}` : 'No mapped products affected.',
        onClick: () => { setView('inventory'); setActiveEntity('ingredient'); setStatusFilter('out') },
      })
    })
    if (validation.productsWithoutRecipe.length) list.push({
      key: 'no-recipe', tone: 'amber',
      text: `${validation.productsWithoutRecipe.length} product${validation.productsWithoutRecipe.length === 1 ? ' has' : 's have'} no assigned ingredients`,
      detail: 'Orders for these products will not deduct any stock.',
      onClick: () => setView('unmapped'),
    })
    if (validation.invalidQtyLinks.length) list.push({
      key: 'bad-qty', tone: 'amber',
      text: `${validation.invalidQtyLinks.length} recipe line${validation.invalidQtyLinks.length === 1 ? '' : 's'} with missing or invalid quantities`,
      detail: 'Zero or negative per-serving quantities never deduct stock.',
      onClick: () => setView('unmapped'),
    })
    if (validation.inactiveLinks.length) list.push({
      key: 'inactive', tone: 'red',
      text: `${validation.inactiveLinks.length} active product recipe${validation.inactiveLinks.length === 1 ? ' uses' : 's use'} a deactivated ingredient`,
      detail: 'These lines are skipped during deduction.',
      onClick: () => setView('unmapped'),
    })
    if (validation.unusedIngredients.length) list.push({
      key: 'unused', tone: 'neutral',
      text: `${validation.unusedIngredients.length} ingredient${validation.unusedIngredients.length === 1 ? ' is' : 's are'} not used by any product`,
      detail: 'Review whether these still belong in active inventory.',
      onClick: () => setView('unmapped'),
    })
    if (validation.unitMissing.length) list.push({
      key: 'units', tone: 'neutral',
      text: `${validation.unitMissing.length} ingredient${validation.unitMissing.length === 1 ? '' : 's'} without a specific measurement unit`,
      detail: 'Set a real unit (g, ml, pcs…) so recipe quantities stay unambiguous.',
      onClick: () => setView('unmapped'),
    })
    return list
  }, [outIngredients, validation, linksByIngredient, menuItemsById])

  // ---- Inventory list derivations ------------------------------------------
  const items = data[activeEntity]
  const categories = useMemo(() => [...new Set(items.map((i) => i.category).filter(Boolean))].sort(), [items])
  const units = useMemo(() => [...new Set(items.map((i) => i.unit).filter(Boolean))].sort(), [items])
  const suppliers = useMemo(() => [...new Set(items.map((i) => i.supplier).filter(Boolean))].sort(), [items])

  const recipeCountForProduct = (item) => {
    if (!item.menuItemId) return null
    return (linksByProduct.get(item.menuItemId) || []).length
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((item) => {
      if (q && !item.name.toLowerCase().includes(q)) return false
      if (categoryFilter !== 'all' && item.category !== categoryFilter) return false
      const status = stockStatus(item)
      if (statusFilter === 'available') { if (item.quantity <= 0) return false }
      else if (statusFilter === 'restock') { if (status !== 'low' && status !== 'out') return false }
      else if (statusFilter !== 'all' && status !== statusFilter) return false
      if (config.hasType && moreFilters.type !== 'all' && item.type !== moreFilters.type) return false
      if (moreFilters.unit !== 'all' && item.unit !== moreFilters.unit) return false
      if (moreFilters.supplier !== 'all' && item.supplier !== moreFilters.supplier) return false
      if (activeEntity === 'ingredient' && moreFilters.mapping !== 'all') {
        const used = (linksByIngredient.get(item.id) || []).length > 0
        if (moreFilters.mapping === 'mapped' && !used) return false
        if (moreFilters.mapping === 'unmapped' && used) return false
      }
      if (activeEntity === 'finished_product' && moreFilters.mapping !== 'all') {
        const count = item.menuItemId ? (linksByProduct.get(item.menuItemId) || []).length : 0
        if (moreFilters.mapping === 'mapped' && count === 0) return false
        if (moreFilters.mapping === 'unmapped' && count > 0) return false
      }
      return true
    })
  }, [items, search, categoryFilter, statusFilter, moreFilters, config.hasType, activeEntity, linksByIngredient, linksByProduct])

  const sorted = useMemo(() => {
    const list = [...filtered]
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortBy === 'name') list.sort((a, b) => a.name.localeCompare(b.name) * dir)
    else if (sortBy === 'quantity') list.sort((a, b) => (a.quantity - b.quantity) * dir)
    else if (sortBy === 'updated') list.sort((a, b) => (new Date(a.updatedAt) - new Date(b.updatedAt)) * dir)
    else if (sortBy === 'category') list.sort((a, b) => (a.category || '').localeCompare(b.category || '') * dir)
    return list
  }, [filtered, sortBy, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize))
  const safePage = Math.min(page, totalPages)
  const pageItems = sorted.slice((safePage - 1) * pageSize, safePage * pageSize)

  const toggleSort = (key) => {
    setSortBy((current) => {
      if (current === key) { setSortDir((d) => (d === 'asc' ? 'desc' : 'asc')); return current }
      setSortDir(key === 'updated' ? 'desc' : 'asc')
      return key
    })
  }

  const counts = useMemo(() => {
    const forList = (list) => ({
      total: list.length,
      low: list.filter((i) => stockStatus(i) === 'low').length,
      out: list.filter((i) => stockStatus(i) === 'out').length,
      available: list.filter((i) => !i.isArchived && i.quantity > 0).length,
      inactive: list.filter((i) => i.isArchived).length,
    })
    // Inactive supplies stay in the list so they can be shown with an
    // "Inactive" badge, but they must not inflate the stock counters.
    const activeSupplies = data.supply.filter((s) => !s.isArchived)
    return {
      ingredient: { ...forList(data.ingredient), unmapped: data.ingredient.filter((i) => !(linksByIngredient.get(i.id)?.length)).length },
      finished_product: forList(data.finished_product),
      supply: { ...forList(activeSupplies), total: activeSupplies.length, inactive: data.supply.length - activeSupplies.length },
    }
  }, [data, linksByIngredient])

  const restockList = useMemo(() => {
    const rows = []
    Object.entries(data).forEach(([entityKey, list]) => {
      list.forEach((item) => {
        const status = stockStatus(item)
        if (status !== 'low' && status !== 'out') return
        const target = item.highStockLevel > 0 ? item.highStockLevel : item.minStockLevel
        const affected = entityKey === 'ingredient'
          ? (linksByIngredient.get(item.id) || []).map((link) => menuItemsById.get(link.menuItemId)?.name).filter(Boolean)
          : []
        rows.push({
          ...item,
          entityKey,
          entityLabel: ENTITY_CONFIGS[entityKey].singular,
          status,
          shortage: Math.max(0, target - item.quantity),
          affected,
          priority: status === 'out' ? 'critical' : item.minStockLevel > 0 && item.quantity <= item.minStockLevel * 0.5 ? 'high' : 'normal',
        })
      })
    })
    const rank = { critical: 0, high: 1, normal: 2 }
    return rows.sort((a, b) => rank[a.priority] - rank[b.priority] || a.name.localeCompare(b.name))
  }, [data, linksByIngredient, menuItemsById])

  const activeChips = useMemo(() => {
    const chips = []
    if (search.trim()) chips.push({ key: 'search', label: `Search: "${search.trim()}"`, clear: () => setSearch('') })
    if (categoryFilter !== 'all') chips.push({ key: 'category', label: categoryFilter, clear: () => setCategoryFilter('all') })
    if (statusFilter !== 'all') {
      const label = statusFilter === 'available' ? 'Available' : statusFilter === 'restock' ? 'Restock Needed' : STATUS_META[statusFilter]?.label || statusFilter
      chips.push({ key: 'status', label, clear: () => setStatusFilter('all') })
    }
    if (config.hasType && moreFilters.type !== 'all') chips.push({ key: 'type', label: `Type: ${moreFilters.type}`, clear: () => setMoreFilters((f) => ({ ...f, type: 'all' })) })
    if (moreFilters.unit !== 'all') chips.push({ key: 'unit', label: `Unit: ${moreFilters.unit}`, clear: () => setMoreFilters((f) => ({ ...f, unit: 'all' })) })
    if (moreFilters.supplier !== 'all') chips.push({ key: 'supplier', label: moreFilters.supplier, clear: () => setMoreFilters((f) => ({ ...f, supplier: 'all' })) })
    if (moreFilters.mapping !== 'all') chips.push({ key: 'mapping', label: moreFilters.mapping === 'mapped' ? 'Mapped' : 'Not mapped', clear: () => setMoreFilters((f) => ({ ...f, mapping: 'all' })) })
    return chips
  }, [search, categoryFilter, statusFilter, moreFilters, config.hasType])

  const clearAllFilters = () => {
    setSearch(''); setCategoryFilter('all'); setStatusFilter('all')
    setMoreFilters({ type: 'all', unit: 'all', supplier: 'all', mapping: 'all' })
    setPage(1)
  }

  // ---- Actions --------------------------------------------------------------
  const runArchive = async (item) => {
    setBusyId(item.id)
    try {
      await ENTITY_CONFIGS[item.itemType].archive(item.id)
      pushToast('success', `${item.name} was deactivated.`)
      setArchiveTarget(null)
      setDrawerItem(null)
      await load({ silent: true })
    } catch (cause) {
      pushToast('error', describeError(cause, 'Could not deactivate this item.'))
    } finally {
      setBusyId('')
    }
  }

  const runSaveForm = async (payload) => {
    const target = formTarget
    const id = await ENTITY_CONFIGS[target.entity].upsert(payload)
    await load({ silent: true })
    pushToast('success', `${payload.name} was saved.`)
    setFormTarget(null)
    return id
  }

  const runAdjust = async ({ delta, movementType, reason }) => {
    const target = adjustTarget
    setBusyId(target.item.id)
    try {
      const nextQty = await adjustStock({ itemType: target.item.itemType, itemId: target.item.id, delta, movementType, reason })
      pushToast('success', `${target.item.name} updated to ${formatQty(nextQty)} ${target.item.unit}.`)
      setAdjustTarget(null)
      await load({ silent: true })
    } catch (cause) {
      pushToast('error', describeError(cause, 'Could not adjust stock.'))
    } finally {
      setBusyId('')
    }
  }

  const runSaveRecipe = async (menuItemId, rows) => {
    await setMenuItemRecipe(menuItemId, rows)
    await load({ silent: true })
    pushToast('success', 'Recipe mapping updated.')
    setRecipeTarget(null)
  }

  const createSupplyOrderRequest = () => {
    const requestItems = restockList.map((row) => ({
      itemType: row.entityKey, id: row.id, name: row.name, unit: row.unit,
      currentStock: row.quantity, shortage: row.shortage, priority: row.priority, supplier: row.supplier || '',
    }))
    try { sessionStorage.setItem('supplyOrderPrefill', JSON.stringify(requestItems)) } catch { /* storage unavailable */ }
    pushToast('success', `Supply order request prepared for ${requestItems.length} item${requestItems.length === 1 ? '' : 's'}.`)
    navigate('/staff/supplies', { state: { requestItems } })
  }

  const openQuickAction = (action) => {
    setQuickOpen(false)
    if (action === 'ingredient' || action === 'finished_product' || action === 'supply') {
      setView('inventory'); setActiveEntity(action)
      setFormTarget({ entity: action, item: null })
    } else if (action === 'receive') {
      setPickerTarget({ mode: 'restock' })
    } else if (action === 'adjust') {
      setPickerTarget({ mode: 'adjustment' })
    } else if (action === 'low') {
      setView('inventory'); setStatusFilter('low'); setPage(1)
    }
  }

  const attentionCount = warnings.length

  // ---- Summary card definitions --------------------------------------------
  const summaryCards = useMemo(() => {
    const c = counts[activeEntity]
    if (activeEntity === 'ingredient') {
      return [
        { key: 'total', icon: Package, tone: 'neutral', label: 'Total Ingredients', value: c.total, onClick: clearAllFilters },
        { key: 'low', icon: AlertTriangle, tone: 'amber', label: 'Low Stock', value: c.low, onClick: () => { setStatusFilter('low'); setPage(1) } },
        { key: 'out', icon: PackageX, tone: 'red', label: 'Out of Stock', value: c.out, onClick: () => { setStatusFilter('out'); setPage(1) } },
        { key: 'unmapped', icon: Link2, tone: 'blue', label: 'Unmapped Ingredients', value: c.unmapped, onClick: () => { setMoreFilters((f) => ({ ...f, mapping: 'unmapped' })); setPage(1) } },
      ]
    }
    if (activeEntity === 'finished_product') {
      return [
        { key: 'total', icon: Box, tone: 'neutral', label: 'Total Finished Products', value: c.total, onClick: clearAllFilters },
        { key: 'available', icon: Check, tone: 'green', label: 'Available', value: c.available, onClick: () => { setStatusFilter('available'); setPage(1) } },
        { key: 'low', icon: AlertTriangle, tone: 'amber', label: 'Low Stock', value: c.low, onClick: () => { setStatusFilter('low'); setPage(1) } },
        { key: 'out', icon: PackageX, tone: 'red', label: 'Out of Stock', value: c.out, onClick: () => { setStatusFilter('out'); setPage(1) } },
      ]
    }
    return [
      { key: 'total', icon: ClipboardList, tone: 'neutral', label: 'Total Supplies', value: c.total, onClick: clearAllFilters },
      { key: 'low', icon: AlertTriangle, tone: 'amber', label: 'Low Stock', value: c.low, onClick: () => { setStatusFilter('low'); setPage(1) } },
      { key: 'out', icon: PackageX, tone: 'red', label: 'Out of Stock', value: c.out, onClick: () => { setStatusFilter('out'); setPage(1) } },
      { key: 'restock', icon: Truck, tone: 'blue', label: 'Restock Needed', value: c.low + c.out, onClick: () => { setStatusFilter('restock'); setPage(1) } },
    ]
  }, [activeEntity, counts])


  return (
    <AppShell role="staff" title="Inventory Management" eyebrow="Manage ingredients, finished products, supplies, stock levels, and product recipe mappings." actions={
      <div className="ops-header-actions ivm-header-actions">
        <div className="ivm-updated" title={lastUpdated ? lastUpdated.toLocaleString('en-PH') : ''}>
          <Clock3 size={13} />
          <span>{lastUpdated ? `Updated ${timeAgo(lastUpdated.toISOString())}` : new Intl.DateTimeFormat('en-PH', { hour: 'numeric', minute: '2-digit', hour12: true }).format(now)}</span>
        </div>
        <div className="inv-overflow">
          <button type="button" className="ops-icon-button" aria-label={`${attentionCount} inventory warning${attentionCount === 1 ? '' : 's'}`} title="Inventory warnings" aria-expanded={notifOpen} onClick={() => { setNotifOpen((o) => !o); setQuickOpen(false) }}>
            <Bell size={18} />
            {attentionCount > 0 && <span className="ops-badge">{attentionCount}</span>}
          </button>
          {notifOpen && (
            <div className="inv-overflow-menu ivm-notif-menu" role="menu">
              {warnings.length === 0 ? <p className="ivm-notif-empty">No inventory warnings. Everything looks healthy.</p> : warnings.map((warning) => (
                <button type="button" role="menuitem" key={warning.key} className={`ivm-notif-item tone-${warning.tone}`} onClick={() => { setNotifOpen(false); warning.onClick?.() }}>
                  <b>{warning.text}</b>
                  <span>{warning.detail}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="ops-icon-button" aria-label="Refresh inventory" title="Refresh" onClick={() => load()} disabled={loading}>
          <RefreshCw size={18} className={loading ? 'spin' : ''} />
        </button>
        <div className="inv-overflow">
          <button type="button" className="ops-main-action inv-record-btn" aria-expanded={quickOpen} onClick={() => { setQuickOpen((o) => !o); setNotifOpen(false) }}>
            <Zap size={15} /> Quick Stock Action <ChevronDown size={14} className={quickOpen ? 'rotated' : ''} />
          </button>
          {quickOpen && (
            <div className="inv-overflow-menu ivm-quick-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => openQuickAction('ingredient')}><Plus size={14} /> Record New Ingredient</button>
              <button type="button" role="menuitem" onClick={() => openQuickAction('finished_product')}><Plus size={14} /> Record New Finished Product</button>
              <button type="button" role="menuitem" onClick={() => openQuickAction('supply')}><Plus size={14} /> Record New Supply</button>
              <button type="button" role="menuitem" onClick={() => openQuickAction('receive')}><PackagePlus size={14} /> Receive Stock</button>
              <button type="button" role="menuitem" onClick={() => openQuickAction('adjust')}><PackageMinus size={14} /> Record Adjustment</button>
              <button type="button" role="menuitem" onClick={() => openQuickAction('low')}><AlertTriangle size={14} /> View Low-Stock Items</button>
            </div>
          )}
        </div>
      </div>
    }>
      {error && !loading && (
        <div className="inv-empty ivm-error">
          <AlertTriangle size={28} />
          <h3>Could not load inventory</h3>
          <p>{error}</p>
          <button type="button" className="ops-main-action" onClick={() => load()}>Retry</button>
        </div>
      )}

      <div className="ivm-view-tabs" role="tablist" aria-label="Inventory views">
        {VIEW_TABS.map(([key, label, Icon]) => (
          <button type="button" key={key} role="tab" aria-selected={view === key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>
            <Icon size={15} /> {label}
            {key === 'unmapped' && (validation.productsWithoutRecipe.length + validation.unusedIngredients.length) > 0 && (
              <i className="ivm-tab-flag">{validation.productsWithoutRecipe.length + validation.unusedIngredients.length}</i>
            )}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="ivm-fade">
          <div className="inv-summary-row">{Array.from({ length: 4 }).map((_, i) => <div className="inv-skeleton-row ivm-skel-card" key={i} />)}</div>
          <div className="inv-skeleton">{Array.from({ length: 8 }).map((_, i) => <div className="inv-skeleton-row" key={i} />)}</div>
        </div>
      ) : error ? null : view === 'inventory' ? (
        <div className="ivm-fade">
          {warnings.length > 0 && (
            <div className="ivm-warning-strip">
              {warnings.slice(0, 3).map((warning) => (
                <button type="button" key={warning.key} className={`ivm-warning tone-${warning.tone}`} onClick={warning.onClick}>
                  <AlertTriangle size={13} /> <b>{warning.text}</b> <span>{warning.detail}</span>
                </button>
              ))}
              {warnings.length > 3 && <button type="button" className="ivm-warning tone-neutral ivm-warning-more" onClick={() => setNotifOpen(true)}>+{warnings.length - 3} more</button>}
            </div>
          )}

          <div className="inv-tabs ivm-entity-tabs" role="tablist">
            {TABS.map((tab) => (
              <button type="button" key={tab.key} role="tab" aria-selected={activeEntity === tab.key} className={activeEntity === tab.key ? 'active' : ''} onClick={() => setActiveEntity(tab.key)}>
                {tab.label} <span className="ivm-tab-count">{counts[tab.key].total}</span>
              </button>
            ))}
          </div>

          <div className="inv-summary-row ivm-summary-row">
            {summaryCards.map((card) => (
              <button type="button" className={`inv-summary-card tone-${card.tone} ivm-summary-clickable`} key={card.key} onClick={card.onClick} title={`Filter by ${card.label}`}>
                <card.icon size={18} /><span>{card.label}</span><b>{card.value}</b>
              </button>
            ))}
          </div>

          <div className="inv-toolbar ivm-toolbar">
            <label className="ops-search">
              <Search size={17} /><span className="sr-only">Search {config.label.toLowerCase()}</span>
              <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder={`Search ${config.label.toLowerCase()}`} />
              {search && <button type="button" className="menu-manage-search-clear" aria-label="Clear search" onClick={() => { setSearch(''); setPage(1) }}><X size={13} /></button>}
            </label>
            <select value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); setPage(1) }} aria-label="Filter by category">
              <option value="all">All categories</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }} aria-label="Filter by stock status">
              <option value="all">All statuses</option>
              {Object.entries(STATUS_META)
                // 'inactive' only applies to supplies — archived ingredients and
                // finished products are filtered out before they reach the page.
                .filter(([key]) => key !== 'inactive' || activeEntity === 'supply')
                .map(([key]) => <option key={key} value={key}>{statusLabel(activeEntity, key)}</option>)}
            </select>
            <select value={`${sortBy}:${sortDir}`} onChange={(e) => { const [key, dir] = e.target.value.split(':'); setSortBy(key); setSortDir(dir) }} aria-label="Sort">
              <option value="name:asc">Name: A to Z</option>
              <option value="name:desc">Name: Z to A</option>
              <option value="quantity:asc">Stock: lowest first</option>
              <option value="quantity:desc">Stock: highest first</option>
              <option value="updated:desc">Recently updated</option>
            </select>
            <div className="inv-overflow">
              <button type="button" className={`ops-secondary-action compact ${moreOpen || activeChips.some((c) => ['type', 'unit', 'supplier', 'mapping'].includes(c.key)) ? 'ivm-more-active' : ''}`} aria-expanded={moreOpen} onClick={() => setMoreOpen((o) => !o)}>
                <Filter size={14} /> More Filters <ChevronDown size={13} className={moreOpen ? 'rotated' : ''} />
              </button>
              {moreOpen && (
                <div className="inv-overflow-menu ivm-filter-pop">
                  {config.hasType && (
                    <label className="field compact"><span>Ingredient type</span>
                      <select value={moreFilters.type} onChange={(e) => { setMoreFilters((f) => ({ ...f, type: e.target.value })); setPage(1) }}>
                        <option value="all">All types</option><option value="wet">Wet</option><option value="dry">Dry</option><option value="other">Other</option>
                      </select>
                    </label>
                  )}
                  <label className="field compact"><span>Unit of measurement</span>
                    <select value={moreFilters.unit} onChange={(e) => { setMoreFilters((f) => ({ ...f, unit: e.target.value })); setPage(1) }}>
                      <option value="all">All units</option>
                      {units.map((u) => <option key={u} value={u}>{u}</option>)}
                    </select>
                  </label>
                  <label className="field compact"><span>Supplier</span>
                    <select value={moreFilters.supplier} onChange={(e) => { setMoreFilters((f) => ({ ...f, supplier: e.target.value })); setPage(1) }}>
                      <option value="all">All suppliers</option>
                      {suppliers.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </label>
                  {activeEntity !== 'supply' && (
                    <label className="field compact"><span>Mapping status</span>
                      <select value={moreFilters.mapping} onChange={(e) => { setMoreFilters((f) => ({ ...f, mapping: e.target.value })); setPage(1) }}>
                        <option value="all">All mapping states</option>
                        <option value="mapped">{activeEntity === 'ingredient' ? 'Used by products' : 'Recipe mapped'}</option>
                        <option value="unmapped">{activeEntity === 'ingredient' ? 'Not used by any product' : 'No recipe mapped'}</option>
                      </select>
                    </label>
                  )}
                  <button type="button" className="ops-secondary-action compact" onClick={() => { setMoreFilters({ type: 'all', unit: 'all', supplier: 'all', mapping: 'all' }); setMoreOpen(false); setPage(1) }}>Reset these filters</button>
                </div>
              )}
            </div>
            <button type="button" className="ops-main-action inv-record-btn" onClick={() => setFormTarget({ entity: activeEntity, item: null })}>
              <Plus size={16} /> Record New {config.singular}
            </button>
          </div>

          {activeChips.length > 0 && (
            <div className="txn-chip-row ivm-chip-row">
              <span className="ivm-chip-count">{activeChips.length} filter{activeChips.length === 1 ? '' : 's'} active</span>
              {activeChips.map((chip) => (
                <span className="txn-filter-chip" key={chip.key}>
                  {chip.label}
                  <button type="button" aria-label={`Remove ${chip.label} filter`} onClick={() => { chip.clear(); setPage(1) }}><X size={12} /></button>
                </span>
              ))}
              <button type="button" className="ivm-clear-all" onClick={clearAllFilters}>Clear All</button>
            </div>
          )}

          {items.length === 0 ? (
            <div className="inv-empty ivm-empty-compact">
              <Box size={26} />
              <h3>No {config.label.toLowerCase()} recorded yet</h3>
              <p>Record your first {config.singular.toLowerCase()} to begin monitoring stock{activeEntity === 'ingredient' ? ' and connecting product recipes' : ''}.</p>
              <button type="button" className="ops-main-action" onClick={() => setFormTarget({ entity: activeEntity, item: null })}><Plus size={15} /> Record New {config.singular}</button>
            </div>
          ) : pageItems.length === 0 ? (
            <div className="inv-empty ivm-empty-compact">
              <Search size={26} />
              <h3>No matching records found</h3>
              <p>Try different keywords or remove some filters.</p>
              <button type="button" className="ops-secondary-action" onClick={clearAllFilters}>Clear Filters</button>
            </div>
          ) : (
            <>
              <div className="inv-table-wrap ivm-table-wrap">
                <table className="inv-table ivm-table">
                  <thead>
                    <tr>
                      <th><SortHeader label={`${config.singular} Name`} sortKey="name" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} /></th>
                      <th><SortHeader label="Category" sortKey="category" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} /></th>
                      <th><SortHeader label="Current Stock" sortKey="quantity" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} /></th>
                      <th>Unit</th>
                      <th>Warning Level</th>
                      <th>Reorder Level</th>
                      {activeEntity === 'supply' && <th>Supplier</th>}
                      <th>Status</th>
                      {activeEntity === 'ingredient' && <th>Used by Products</th>}
                      {activeEntity === 'finished_product' && <th>Ingredients Mapped</th>}
                      {activeEntity === 'supply' && <th>Used by Products</th>}
                      {activeEntity === 'supply' && <th>Last Restocked</th>}
                      <th><SortHeader label="Last Updated" sortKey="updated" sortBy={sortBy} sortDir={sortDir} onSort={toggleSort} /></th>
                      {activeEntity === 'supply' && <th>Updated By</th>}
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((item) => {
                      const status = stockStatus(item)
                      const usage = activeEntity === 'ingredient' ? (linksByIngredient.get(item.id) || []) : []
                      const supplyUsage = activeEntity === 'supply' ? (supplyLinksBySupply.get(item.id) || []) : []
                      const recipeCount = activeEntity === 'finished_product' ? recipeCountForProduct(item) : null
                      return (
                        <tr key={item.id} className="ivm-row" onClick={() => setDrawerItem(item)}>
                          <td><b>{item.name}</b></td>
                          <td>{item.category || '—'}</td>
                          <td><b>{formatQty(item.quantity)}</b></td>
                          <td>{item.unit}</td>
                          <td>{formatQty(item.minStockLevel)}</td>
                          <td>{item.highStockLevel > 0 ? formatQty(item.highStockLevel) : '—'}</td>
                          {activeEntity === 'supply' && <td>{item.supplier || '—'}</td>}
                          <td><span className={`inv-status tone-${STATUS_META[status].tone}`}>{statusLabel(activeEntity, status)}</span></td>
                          {activeEntity === 'ingredient' && (
                            <td>
                              {usage.length === 0
                                ? <span className="ivm-map-badge none">Not mapped</span>
                                : <button type="button" className="ivm-map-badge linked" onClick={(e) => { e.stopPropagation(); setDrawerItem(item) }}>Used by {usage.length} product{usage.length === 1 ? '' : 's'}</button>}
                            </td>
                          )}
                          {activeEntity === 'finished_product' && (
                            <td>
                              {!item.menuItemId
                                ? <span className="ivm-map-badge none">Not linked</span>
                                : recipeCount > 0
                                  ? <button type="button" className="ivm-map-badge linked" onClick={(e) => { e.stopPropagation(); setRecipeTarget(menuItemsById.get(item.menuItemId) || { id: item.menuItemId, name: item.name }) }}>{recipeCount} ingredient{recipeCount === 1 ? '' : 's'}</button>
                                  : <button type="button" className="ivm-map-badge warn" onClick={(e) => { e.stopPropagation(); setRecipeTarget(menuItemsById.get(item.menuItemId) || { id: item.menuItemId, name: item.name }) }}>No recipe</button>}
                            </td>
                          )}
                          {activeEntity === 'supply' && (
                            <td>
                              {supplyUsage.length === 0
                                ? <span className="ivm-map-badge none">Manual count</span>
                                : <button type="button" className="ivm-map-badge linked" onClick={(e) => { e.stopPropagation(); setDrawerItem(item) }}>{supplyUsage.length} mapping{supplyUsage.length === 1 ? '' : 's'}</button>}
                            </td>
                          )}
                          {activeEntity === 'supply' && <td>{item.lastRestockedAt ? timeAgo(item.lastRestockedAt) : 'Never'}</td>}
                          <td>{timeAgo(item.updatedAt)}</td>
                          {activeEntity === 'supply' && <td>{item.updatedBy || '—'}</td>}
                          <td onClick={(e) => e.stopPropagation()}>
                            <RowActions item={item} entity={activeEntity} menuOpen={menuOpenId === item.id} menuItemsById={menuItemsById}
                              onToggleMenu={() => setMenuOpenId((id) => (id === item.id ? '' : item.id))}
                              onView={() => { setDrawerItem(item); setMenuOpenId('') }}
                              onReceive={() => { setAdjustTarget({ item, mode: 'restock' }); setMenuOpenId('') }}
                              onAdjust={() => { setAdjustTarget({ item, mode: 'adjustment' }); setMenuOpenId('') }}
                              onEdit={() => { setFormTarget({ entity: activeEntity, item }); setMenuOpenId('') }}
                              onRecipe={() => { setRecipeTarget(menuItemsById.get(item.menuItemId)); setMenuOpenId('') }}
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
                      <div className="inv-card-top"><b>{item.name}</b><span className={`inv-status tone-${STATUS_META[status].tone}`}>{statusLabel(activeEntity, status)}</span></div>
                      <p className="inv-card-meta">{item.category || 'Uncategorized'}{config.hasType ? ` · ${item.type}` : ''}{item.supplier ? ` · ${item.supplier}` : ''}</p>
                      <p className="inv-card-qty">{formatQty(item.quantity)} {item.unit}</p>
                      <p className="inv-card-thresholds">Warning: {formatQty(item.minStockLevel)} · Reorder: {item.highStockLevel > 0 ? formatQty(item.highStockLevel) : '—'} · Updated {timeAgo(item.updatedAt)}</p>
                      <div className="inv-card-actions">
                        <button type="button" className="ops-secondary-action" onClick={() => setDrawerItem(item)}>View</button>
                        <button type="button" className="ops-secondary-action" onClick={() => setAdjustTarget({ item, mode: 'restock' })}><PackagePlus size={14} /> Receive</button>
                        <button type="button" className="ops-secondary-action" onClick={() => setAdjustTarget({ item, mode: 'adjustment' })}><PackageMinus size={14} /> Adjust</button>
                      </div>
                    </article>
                  )
                })}
              </div>

              <div className="inv-pagination ivm-pagination">
                <button type="button" disabled={safePage === 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
                <span>Page {safePage} of {totalPages} · {sorted.length} record{sorted.length === 1 ? '' : 's'}</span>
                <select value={pageSize} onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1) }} aria-label="Rows per page">
                  <option value={10}>10 / page</option>
                  <option value={20}>20 / page</option>
                  <option value={50}>50 / page</option>
                </select>
                <button type="button" disabled={safePage === totalPages} onClick={() => setPage((p) => p + 1)}>Next</button>
              </div>
            </>
          )}

          {restockList.length > 0 && (
            <section className="panel ivm-restock-panel">
              <div className="panel-head">
                <div><span>Restock Needed</span><small>{restockList.length} item{restockList.length === 1 ? '' : 's'} at or below warning level</small></div>
                <button type="button" className="ops-main-action compact" onClick={createSupplyOrderRequest}><Truck size={15} /> Create Supply Order Request</button>
              </div>
              <div className="ivm-restock-list">
                {restockList.slice(0, 8).map((row) => (
                  <button type="button" className="ivm-restock-row" key={`${row.entityKey}-${row.id}`} onClick={() => { setActiveEntity(row.entityKey); setDrawerItem(row) }}>
                    <span className={`ivm-priority ${row.priority}`}>{row.priority === 'critical' ? 'Critical' : row.priority === 'high' ? 'High' : 'Normal'}</span>
                    <div className="ivm-restock-info">
                      <b>{row.name}</b>
                      <small>{row.entityLabel} · {formatQty(row.quantity)} / warn {formatQty(row.minStockLevel)} {row.unit}{row.shortage > 0 ? ` · short ${formatQty(row.shortage)} ${row.unit}` : ''}</small>
                      {row.affected.length > 0 && <small className="ivm-restock-affected">Affects: {row.affected.slice(0, 3).join(', ')}{row.affected.length > 3 ? ` +${row.affected.length - 3} more` : ''}</small>}
                    </div>
                    <span className="ivm-restock-action">{row.status === 'out' ? 'Restock now' : 'Reorder soon'}</span>
                  </button>
                ))}
                {restockList.length > 8 && <p className="ivm-restock-more">{restockList.length - 8} more item{restockList.length - 8 === 1 ? '' : 's'} need restocking — filter by Low Stock or Out of Stock above.</p>}
              </div>
            </section>
          )}

          <section className="panel ivm-activity-panel">
            <div className="panel-head">
              <div><span>Recent Inventory Activity</span><small>Latest stock movements across all item types</small></div>
              <button type="button" className="text-link dark" onClick={() => setView('activity')}>View all <ChevronRight size={14} /></button>
            </div>
            <ActivityList rows={activity.slice(0, 6)} compact />
          </section>
        </div>
      ) : view === 'recipes' ? (
        <RecipeMappingView
          mapMode={mapMode} setMapMode={setMapMode}
          mapSearch={mapSearch} setMapSearch={setMapSearch}
          mapCategory={mapCategory} setMapCategory={setMapCategory}
          mapStatus={mapStatus} setMapStatus={setMapStatus}
          expandedId={expandedMapId} setExpandedId={setExpandedMapId}
          menuItems={recipeMatrix.menuItems} linksByProduct={linksByProduct} linksByIngredient={linksByIngredient}
          ingredients={data.ingredient} ingredientById={ingredientById} menuItemsById={menuItemsById}
          validation={validation}
          supplyLinksByProduct={supplyLinksByProduct} supplyById={supplyById}
          onEditRecipe={(product) => setRecipeTarget(product)}
          onViewIngredient={(ingredient) => { setActiveEntity('ingredient'); setDrawerItem(ingredient) }}
        />
      ) : view === 'unmapped' ? (
        <UnmappedView validation={validation} menuItemsById={menuItemsById} ingredientById={ingredientById}
          onEditRecipe={(product) => setRecipeTarget(product)}
          onViewIngredient={(ingredient) => { setView('inventory'); setActiveEntity('ingredient'); setDrawerItem(ingredient) }} />
      ) : (
        <section className="panel ivm-activity-panel ivm-fade">
          <div className="panel-head">
            <div><span>Recent Inventory Activity</span><small>Order deductions, restocks, adjustments, and waste — full movement history lives in Admin → Inventory Report</small></div>
          </div>
          <ActivityList rows={activity} />
        </section>
      )}

      {formTarget && (
        <ItemFormModal config={ENTITY_CONFIGS[formTarget.entity]} item={formTarget.item} menuItems={menuItems} onClose={() => setFormTarget(null)} onSave={runSaveForm} />
      )}
      {drawerItem && (
        <ItemDrawer
          config={ENTITY_CONFIGS[drawerItem.itemType] || config}
          item={data[drawerItem.itemType]?.find((i) => i.id === drawerItem.id) || drawerItem}
          usage={(linksByIngredient.get(drawerItem.id) || []).map((link) => ({
            ...link,
            product: menuItemsById.get(link.menuItemId),
          }))}
          supplyUsage={(supplyLinksBySupply.get(drawerItem.id) || []).map((link) => ({
            ...link,
            product: link.menuItemId ? menuItemsById.get(link.menuItemId) : null,
          }))}
          onClose={() => setDrawerItem(null)}
          onReceive={() => { setAdjustTarget({ item: drawerItem, mode: 'restock' }) }}
          onAdjust={() => { setAdjustTarget({ item: drawerItem, mode: 'adjustment' }) }}
          onEdit={() => { setFormTarget({ entity: drawerItem.itemType, item: drawerItem }); setDrawerItem(null) }} />
      )}
      {adjustTarget && (
        <AdjustStockModal target={adjustTarget} busy={busyId === adjustTarget.item.id} onClose={() => setAdjustTarget(null)} onConfirm={runAdjust} />
      )}
      {archiveTarget && (
        <DeactivateConfirmModal item={archiveTarget} usageCount={(linksByIngredient.get(archiveTarget.id) || []).length} busy={busyId === archiveTarget.id} onClose={() => setArchiveTarget(null)} onConfirm={() => runArchive(archiveTarget)} />
      )}
      {recipeTarget && (
        <RecipeEditorModal product={recipeTarget} ingredients={data.ingredient} onClose={() => setRecipeTarget(null)} onSave={runSaveRecipe} />
      )}
      {pickerTarget && (
        <ItemPickerModal data={data} mode={pickerTarget.mode} onClose={() => setPickerTarget(null)}
          onPick={(item) => { setPickerTarget(null); setAdjustTarget({ item, mode: pickerTarget.mode }) }} />
      )}

      <div className="ops-toasts" role="status" aria-live="polite">
        {toasts.map((t) => <div className={`ops-toast ops-toast-${t.type}`} key={t.id}>{t.type === 'success' ? <Check size={15} /> : <AlertTriangle size={15} />} {t.message}</div>)}
      </div>
    </AppShell>
  )
}

function SortHeader({ label, sortKey, sortBy, sortDir, onSort }) {
  const active = sortBy === sortKey
  return (
    <button type="button" className={`ivm-sort ${active ? 'active' : ''}`} onClick={() => onSort(sortKey)} aria-label={`Sort by ${label}`}>
      {label}
      {active ? (sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : null}
    </button>
  )
}

function RowActions({ item, entity, menuOpen, menuItemsById, onToggleMenu, onView, onReceive, onAdjust, onEdit, onRecipe, onArchive }) {
  const canRecipe = entity === 'finished_product' && item.menuItemId && menuItemsById.has(item.menuItemId)
  return (
    <div className="inv-overflow">
      <button type="button" className="ops-icon-button small" aria-label={`Actions for ${item.name}`} aria-expanded={menuOpen} onClick={onToggleMenu}><MoreVertical size={15} /></button>
      {menuOpen && (
        <div className="inv-overflow-menu" role="menu">
          <button type="button" role="menuitem" onClick={onView}><ListChecks size={14} /> View Details</button>
          <button type="button" role="menuitem" onClick={onReceive}><PackagePlus size={14} /> Receive Stock</button>
          <button type="button" role="menuitem" onClick={onAdjust}><PackageMinus size={14} /> Record Adjustment</button>
          <button type="button" role="menuitem" onClick={onEdit}><Pencil size={14} /> Edit Item</button>
          <button type="button" role="menuitem" onClick={onView}><History size={14} /> View Movement History</button>
          {entity === 'ingredient' && <button type="button" role="menuitem" onClick={onView}><Utensils size={14} /> View Related Products</button>}
          {canRecipe && <button type="button" role="menuitem" onClick={onRecipe}><ChefHat size={14} /> Manage Recipe Mapping</button>}
          <button type="button" role="menuitem" className="danger" onClick={onArchive}><Archive size={14} /> Deactivate Item</button>
        </div>
      )}
    </div>
  )
}

function ActivityList({ rows, compact = false }) {
  if (rows.length === 0) return <p className="ops-proof-pending">No inventory activity recorded yet. Movements appear here as stock is received, adjusted, or deducted by orders.</p>
  return (
    <ul className={`ivm-activity-list ${compact ? 'compact' : ''}`}>
      {rows.map((row) => {
        const meta = MOVEMENT_META[row.movementType] || MOVEMENT_META.adjustment
        return (
          <li key={row.id} className="ivm-activity-row">
            <span className={`ivm-activity-icon tone-${row.isOrderDeduction ? 'order' : meta.tone}`}>
              {row.isOrderDeduction ? <ShoppingBag size={14} /> : row.movementType === 'restock' ? <PackagePlus size={14} /> : row.movementType === 'waste' ? <PackageX size={14} /> : <PackageMinus size={14} />}
            </span>
            <div className="ivm-activity-info">
              <b>{row.itemName} <small>· {row.isOrderDeduction ? 'Order deduction' : meta.label}</small></b>
              <span>{row.reason || 'No reason recorded'}</span>
            </div>
            <div className="ivm-activity-meta">
              <b className={`ivm-activity-qty tone-${meta.tone}`}>{meta.sign}{formatQty(row.quantity)} {row.unit}</b>
              <small>{row.staffName} · {timeAgo(row.createdAt)}</small>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

function RecipeMappingView({
  mapMode, setMapMode, mapSearch, setMapSearch, mapCategory, setMapCategory, mapStatus, setMapStatus,
  expandedId, setExpandedId, menuItems, linksByProduct, linksByIngredient, ingredients, ingredientById,
  menuItemsById, validation, supplyLinksByProduct, supplyById, onEditRecipe, onViewIngredient,
}) {
  const productCategories = useMemo(() => [...new Set(menuItems.map((m) => m.category).filter(Boolean))].sort(), [menuItems])
  const ingredientCategories = useMemo(() => [...new Set(ingredients.map((i) => i.category).filter(Boolean))].sort(), [ingredients])

  const productRows = useMemo(() => {
    const q = mapSearch.trim().toLowerCase()
    return menuItems.filter((product) => {
      if (q && !product.name.toLowerCase().includes(q)) return false
      if (mapCategory !== 'all' && product.category !== mapCategory) return false
      const links = linksByProduct.get(product.id) || []
      const state = links.length === 0 ? 'unmapped' : validation.incompleteProductIds.has(product.id) ? 'incomplete' : 'complete'
      if (mapStatus !== 'all' && state !== mapStatus) return false
      return true
    })
  }, [menuItems, mapSearch, mapCategory, mapStatus, linksByProduct, validation.incompleteProductIds])

  const ingredientRows = useMemo(() => {
    const q = mapSearch.trim().toLowerCase()
    return ingredients.filter((ingredient) => {
      if (q && !ingredient.name.toLowerCase().includes(q)) return false
      if (mapCategory !== 'all' && ingredient.category !== mapCategory) return false
      const used = (linksByIngredient.get(ingredient.id) || []).length > 0
      if (mapStatus === 'used' && !used) return false
      if (mapStatus === 'unused' && used) return false
      return true
    })
  }, [ingredients, mapSearch, mapCategory, mapStatus, linksByIngredient])

  return (
    <div className="ivm-fade">
      <div className="ivm-map-header">
        <div className="ivm-map-toggle" role="tablist" aria-label="Mapping view">
          <button type="button" role="tab" aria-selected={mapMode === 'product'} className={mapMode === 'product' ? 'active' : ''} onClick={() => { setMapMode('product'); setMapStatus('all'); setMapCategory('all'); setExpandedId('') }}><Utensils size={14} /> View by Product</button>
          <button type="button" role="tab" aria-selected={mapMode === 'ingredient'} className={mapMode === 'ingredient' ? 'active' : ''} onClick={() => { setMapMode('ingredient'); setMapStatus('all'); setMapCategory('all'); setExpandedId('') }}><Package size={14} /> View by Ingredient</button>
        </div>
        <div className="ivm-map-filters">
          <label className="ops-search">
            <Search size={16} /><span className="sr-only">Search mappings</span>
            <input value={mapSearch} onChange={(e) => setMapSearch(e.target.value)} placeholder={mapMode === 'product' ? 'Search products' : 'Search ingredients'} />
          </label>
          <select value={mapCategory} onChange={(e) => setMapCategory(e.target.value)} aria-label="Category">
            <option value="all">All categories</option>
            {(mapMode === 'product' ? productCategories : ingredientCategories).map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={mapStatus} onChange={(e) => setMapStatus(e.target.value)} aria-label="Mapping status">
            {mapMode === 'product' ? (
              <>
                <option value="all">All recipe states</option>
                <option value="complete">Complete recipe</option>
                <option value="incomplete">Needs attention</option>
                <option value="unmapped">No ingredients assigned</option>
              </>
            ) : (
              <>
                <option value="all">All ingredients</option>
                <option value="used">Used by products</option>
                <option value="unused">Not used by any product</option>
              </>
            )}
          </select>
        </div>
      </div>

      {mapMode === 'product' ? (
        productRows.length === 0 ? (
          <div className="inv-empty ivm-empty-compact"><ChefHat size={26} /><h3>No products match</h3><p>Try different keywords or another recipe state.</p></div>
        ) : (
          <div className="ivm-map-list">
            {productRows.map((product) => {
              const links = linksByProduct.get(product.id) || []
              const state = links.length === 0 ? 'unmapped' : validation.incompleteProductIds.has(product.id) ? 'incomplete' : 'complete'
              const expanded = expandedId === product.id
              return (
                <article className={`ivm-map-row ${expanded ? 'expanded' : ''}`} key={product.id}>
                  <button type="button" className="ivm-map-row-head" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? '' : product.id)}>
                    <ChevronRight size={15} className={`ivm-map-caret ${expanded ? 'open' : ''}`} />
                    {product.imageUrl ? <img className="ivm-map-thumb" src={product.imageUrl.startsWith('/') || product.imageUrl.startsWith('http') ? product.imageUrl : `/${product.imageUrl}`} alt="" /> : <span className="ivm-map-thumb ivm-map-thumb-empty"><Utensils size={14} /></span>}
                    <div className="ivm-map-title">
                      <b>{product.name}</b>
                      <small>{product.category}{product.isAvailable ? '' : ' · currently unavailable'}</small>
                    </div>
                    <span className="ivm-map-count">{links.length} ingredient{links.length === 1 ? '' : 's'}</span>
                    <span className={`ivm-map-badge ${state === 'complete' ? 'linked' : state === 'incomplete' ? 'warn' : 'none'}`}>
                      {state === 'complete' ? 'Recipe complete' : state === 'incomplete' ? 'Needs attention' : 'No recipe'}
                    </span>
                    <small className="ivm-map-updated">{timeAgo(product.updatedAt)}</small>
                  </button>
                  {expanded && (
                    <div className="ivm-map-detail">
                      {links.length === 0 ? (
                        <p className="ops-proof-pending">No ingredients assigned. Orders for this product will not deduct any stock.</p>
                      ) : (
                        <ul className="ivm-recipe-lines">
                          {links.map((link) => {
                            const ingredient = ingredientById.get(link.ingredientId)
                            const bad = link.quantityPerServing == null || link.quantityPerServing <= 0
                            return (
                              <li key={`${link.menuItemId}-${link.ingredientId}`}>
                                <b>{ingredient?.name || 'Deactivated ingredient'}</b>
                                <span className={bad ? 'ivm-line-bad' : ''}>{bad ? 'Invalid quantity' : `${formatQty(link.quantityPerServing)} ${ingredient?.unit || ''} per serving`}</span>
                                {ingredient
                                  ? <span className={`inv-status tone-${STATUS_META[stockStatus(ingredient)].tone}`}>{STATUS_META[stockStatus(ingredient)].label}</span>
                                  : <span className="inv-status tone-red">Deactivated</span>}
                              </li>
                            )
                          })}
                        </ul>
                      )}
                      {(() => {
                        const packaging = supplyLinksByProduct?.get(product.id) || []
                        return (
                          <div className="ivm-packaging-block">
                            <h4>Packaging</h4>
                            {packaging.length === 0 ? (
                              <p className="ops-proof-pending">No supplies mapped to this product.</p>
                            ) : (
                              <ul className="ivm-recipe-lines">
                                {packaging.map((link) => {
                                  const supply = supplyById?.get(link.supplyId)
                                  return (
                                    <li key={link.id}>
                                      <b>{supply?.name || 'Unknown supply'}</b>
                                      <span>{formatQty(link.quantityPerServing)} {supply?.unit || ''}</span>
                                      <span className="ivm-cond-chip">{conditionLabel(link)}</span>
                                    </li>
                                  )
                                })}
                              </ul>
                            )}
                          </div>
                        )
                      })()}
                      <div className="ivm-map-detail-actions">
                        <button type="button" className="ops-main-action compact" onClick={() => onEditRecipe(product)}><ChefHat size={14} /> {links.length ? 'Edit Recipe' : 'Assign Ingredients'}</button>
                      </div>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )
      ) : ingredientRows.length === 0 ? (
        <div className="inv-empty ivm-empty-compact"><Package size={26} /><h3>No ingredients match</h3><p>Try different keywords or another usage state.</p></div>
      ) : (
        <div className="ivm-map-list">
          {ingredientRows.map((ingredient) => {
            const links = linksByIngredient.get(ingredient.id) || []
            const expanded = expandedId === ingredient.id
            const status = stockStatus(ingredient)
            return (
              <article className={`ivm-map-row ${expanded ? 'expanded' : ''}`} key={ingredient.id}>
                <button type="button" className="ivm-map-row-head" aria-expanded={expanded} onClick={() => setExpandedId(expanded ? '' : ingredient.id)}>
                  <ChevronRight size={15} className={`ivm-map-caret ${expanded ? 'open' : ''}`} />
                  <span className="ivm-map-thumb ivm-map-thumb-empty"><Package size={14} /></span>
                  <div className="ivm-map-title">
                    <b>{ingredient.name}</b>
                    <small>{ingredient.category || 'Uncategorized'} · {formatQty(ingredient.quantity)} {ingredient.unit}</small>
                  </div>
                  <span className={`inv-status tone-${STATUS_META[status].tone}`}>{STATUS_META[status].label}</span>
                  <span className={`ivm-map-badge ${links.length ? 'linked' : 'none'}`}>{links.length ? `${links.length} product${links.length === 1 ? '' : 's'}` : 'Unused'}</span>
                  <small className="ivm-map-updated">{timeAgo(ingredient.updatedAt)}</small>
                </button>
                {expanded && (
                  <div className="ivm-map-detail">
                    {links.length === 0 ? (
                      <p className="ops-proof-pending">Not used by any product recipe.</p>
                    ) : (
                      <ul className="ivm-recipe-lines">
                        {links.map((link) => {
                          const product = menuItemsById.get(link.menuItemId)
                          return (
                            <li key={`${link.menuItemId}-${link.ingredientId}`}>
                              <b>{product?.name || 'Unknown product'}</b>
                              <span>{formatQty(link.quantityPerServing || 0)} {ingredient.unit} per serving</span>
                              {product && !product.isAvailable && <span className="inv-status tone-amber">Unavailable</span>}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                    <div className="ivm-map-detail-actions">
                      <span className="ivm-map-note">{links.length} affected product{links.length === 1 ? '' : 's'}</span>
                      <button type="button" className="ops-secondary-action compact" onClick={() => onViewIngredient(ingredient)}><ListChecks size={14} /> View Ingredient Details</button>
                    </div>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </div>
  )
}

function UnmappedView({ validation, menuItemsById, ingredientById, onEditRecipe, onViewIngredient }) {
  const panels = [
    {
      key: 'products', title: 'Products without ingredients', tone: 'amber',
      description: 'Orders for these products complete without deducting any stock.',
      rows: validation.productsWithoutRecipe.map((product) => ({
        id: product.id, label: product.name, sub: product.category,
        action: { label: 'Assign Ingredients', run: () => onEditRecipe(product) },
      })),
      empty: 'Every product has at least one ingredient assigned.',
    },
    {
      key: 'ingredients', title: 'Unused ingredients', tone: 'neutral',
      description: 'Recorded in inventory but not part of any product recipe.',
      rows: validation.unusedIngredients.map((ingredient) => ({
        id: ingredient.id, label: ingredient.name, sub: `${formatQty(ingredient.quantity)} ${ingredient.unit} on hand`,
        action: { label: 'View Item', run: () => onViewIngredient(ingredient) },
      })),
      empty: 'Every active ingredient is used by at least one product.',
    },
    {
      key: 'quantities', title: 'Invalid recipe quantities', tone: 'red',
      description: 'Zero, negative, or missing per-serving quantities never deduct stock.',
      rows: validation.invalidQtyLinks.map((link) => {
        const product = menuItemsById.get(link.menuItemId)
        const ingredient = ingredientById.get(link.ingredientId)
        return {
          id: `${link.menuItemId}-${link.ingredientId}`,
          label: `${product?.name || 'Unknown product'} → ${ingredient?.name || 'Deactivated ingredient'}`,
          sub: link.quantityPerServing == null ? 'Missing quantity' : `Quantity: ${link.quantityPerServing}`,
          action: product ? { label: 'Fix Recipe', run: () => onEditRecipe(product) } : null,
        }
      }),
      empty: 'All recipe quantities are valid.',
    },
    {
      key: 'inactive', title: 'Deactivated ingredients in active products', tone: 'red',
      description: 'These recipe lines are skipped during order deduction.',
      rows: validation.inactiveLinks.map((link) => {
        const product = menuItemsById.get(link.menuItemId)
        return {
          id: `${link.menuItemId}-${link.ingredientId}`,
          label: product?.name || 'Unknown product',
          sub: 'Recipe references an ingredient that is no longer active',
          action: product ? { label: 'Fix Recipe', run: () => onEditRecipe(product) } : null,
        }
      }),
      empty: 'No active product uses a deactivated ingredient.',
    },
    {
      key: 'units', title: 'Ingredients without a specific unit', tone: 'neutral',
      description: 'A generic unit makes recipe quantities ambiguous.',
      rows: validation.unitMissing.map((ingredient) => ({
        id: ingredient.id, label: ingredient.name, sub: `Current unit: ${ingredient.unit || 'none'}`,
        action: { label: 'View Item', run: () => onViewIngredient(ingredient) },
      })),
      empty: 'Every ingredient has a specific measurement unit.',
    },
  ]

  return (
    <div className="ivm-unmapped-grid ivm-fade">
      {panels.map((panel) => (
        <section className="panel ivm-unmapped-panel" key={panel.key}>
          <div className="panel-head">
            <div>
              <span>{panel.title} <i className={`ivm-tab-flag tone-${panel.tone}`}>{panel.rows.length}</i></span>
              <small>{panel.description}</small>
            </div>
          </div>
          {panel.rows.length === 0 ? (
            <p className="ivm-unmapped-clear"><Check size={14} /> {panel.empty}</p>
          ) : (
            <ul className="ivm-unmapped-list">
              {panel.rows.slice(0, 6).map((row) => (
                <li key={row.id}>
                  <div><b>{row.label}</b><small>{row.sub}</small></div>
                  {row.action && <button type="button" className="ops-secondary-action compact" onClick={row.action.run}>{row.action.label}</button>}
                </li>
              ))}
              {panel.rows.length > 6 && <li className="ivm-unmapped-more">+{panel.rows.length - 6} more</li>}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}

function ItemFormModal({ config, item, menuItems, onClose, onSave }) {
  const [values, setValues] = useState({
    name: item?.name || '', category: item?.category || '', type: item?.type || 'other', unit: item?.unit || '',
    minStockLevel: item?.minStockLevel ?? 10, highStockLevel: item?.highStockLevel ?? (config.key === 'ingredient' ? 500 : 100),
    supplier: item?.supplier || '', notes: item?.notes || '', initialQuantity: item ? item.quantity : 0, menuItemId: item?.menuItemId || '',
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
    if (Number.isNaN(min) || min < 0) return setError('The warning level must be zero or greater.')
    if (Number.isNaN(high) || high < 0) return setError('The reorder level must be zero or greater.')
    if (high > 0 && min > high) return setError('The warning level cannot exceed the reorder level.')
    if (!item) {
      const initial = Number(values.initialQuantity)
      if (Number.isNaN(initial) || initial < 0) return setError('Starting quantity cannot be negative.')
    }
    setSaving(true); setError('')
    try {
      await onSave({ id: item?.id, ...values, minStockLevel: min, highStockLevel: high, initialQuantity: Number(values.initialQuantity) })
    } catch (cause) {
      setError(describeError(cause, 'Could not save this item.'))
      setSaving(false)
    }
  }

  return (
    <div className="payment-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose() }}>
      <section className="payment-modal inv-form-modal" role="dialog" aria-modal="true" aria-labelledby="inv-form-title">
        <button className="payment-modal-close" type="button" onClick={onClose} disabled={saving} aria-label="Close">×</button>
        <span className="payment-modal-kicker">{item ? `Edit ${config.singular}` : `New ${config.singular}`}</span>
        <h2 id="inv-form-title">{item ? item.name : `Record a new ${config.singular.toLowerCase()}`}</h2>
        <form onSubmit={submit}>
          <div className="form-grid">
            <label className="field"><span>{config.singular} name</span><input value={values.name} onChange={(e) => set('name', e.target.value)} required /></label>
            <label className="field"><span>Category</span><input value={values.category} onChange={(e) => set('category', e.target.value)} placeholder="e.g. Milk, Protein, Syrup" /></label>
            {config.hasType && (
              <label className="field"><span>Type</span>
                <select value={values.type} onChange={(e) => set('type', e.target.value)}>
                  <option value="wet">Wet</option><option value="dry">Dry</option><option value="other">Other</option>
                </select>
              </label>
            )}
            {config.hasMenuLink && (
              <label className="field"><span>Linked menu item (optional)</span>
                <select value={values.menuItemId} onChange={(e) => set('menuItemId', e.target.value)}>
                  <option value="">Not linked</option>
                  {menuItems.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </label>
            )}
            <label className="field"><span>Unit</span><input value={values.unit} onChange={(e) => set('unit', e.target.value)} placeholder="kg, L, pcs" required /></label>
            {!item && <label className="field"><span>Starting quantity</span><input type="number" min="0" step="any" value={values.initialQuantity} onChange={(e) => set('initialQuantity', e.target.value)} /></label>}
            <label className="field"><span>Warning level (low-stock alert)</span><input type="number" min="0" step="any" value={values.minStockLevel} onChange={(e) => set('minStockLevel', e.target.value)} required /></label>
            <label className="field"><span>Reorder level (healthy target)</span><input type="number" min="0" step="any" value={values.highStockLevel} onChange={(e) => set('highStockLevel', e.target.value)} required /></label>
            <label className="field"><span>Supplier (optional)</span><input value={values.supplier} onChange={(e) => set('supplier', e.target.value)} /></label>
          </div>
          <label className="field"><span>Notes (optional)</span><textarea rows="3" value={values.notes} onChange={(e) => set('notes', e.target.value)} /></label>
          {error && <p className="form-error">{error}</p>}
          <div className="payment-modal-actions">
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
  const [direction, setDirection] = useState(target.mode === 'restock' ? 'restock' : 'deduction')
  const [movementType, setMovementType] = useState(target.mode === 'restock' ? 'restock' : 'deduction')
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
          <p><b>Type:</b> {movementType} · <b>Reason:</b> {reason}{reference ? ` — Ref: ${reference}` : ''}</p>
          <p className="ivm-confirm-meta">Recorded under your staff account with the current date and time.</p>
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
        <span className="payment-modal-kicker">{target.mode === 'restock' ? 'Receive stock' : 'Stock adjustment'}</span>
        <h2 id="inv-adjust-title">{item.name}</h2>
        <form onSubmit={submit}>
          <div className="inv-direction-toggle">
            <button type="button" className={direction === 'restock' ? 'active' : ''} onClick={() => setDirection('restock')}><PackagePlus size={15} /> Add</button>
            <button type="button" className={direction === 'deduction' ? 'active' : ''} onClick={() => setDirection('deduction')}><PackageMinus size={15} /> Deduct</button>
          </div>
          <div className="form-grid">
            <label className="field"><span>Amount ({item.unit})</span><input type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required /></label>
            <label className="field"><span>Adjustment type</span>
              <select value={movementType} onChange={(e) => setMovementType(e.target.value)}>
                {direction === 'restock' ? <option value="restock">Restock</option> : <><option value="deduction">Deduction</option><option value="waste">Waste / Spoilage</option></>}
                <option value="adjustment">Adjustment (recount)</option>
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

function DeactivateConfirmModal({ item, usageCount, busy, onClose, onConfirm }) {
  return (
    <div className="payment-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <section className="payment-modal" role="alertdialog" aria-modal="true" aria-labelledby="inv-archive-title">
        <span className="payment-modal-kicker">Deactivate item</span>
        <h2 id="inv-archive-title">Deactivate {item.name}?</h2>
        <p>This removes it from active inventory lists without deleting its stock history or recipe links.</p>
        {usageCount > 0 && (
          <p className="form-error">This ingredient is used by {usageCount} product recipe{usageCount === 1 ? '' : 's'}. Those recipe lines will be skipped during order deduction until the mapping is updated.</p>
        )}
        <div className="payment-modal-actions">
          <button className="secondary-button" type="button" onClick={onClose} disabled={busy}>Keep item</button>
          <button className="danger-button" type="button" disabled={busy} onClick={onConfirm}>{busy ? 'Deactivating…' : 'Deactivate item'}</button>
        </div>
      </section>
    </div>
  )
}

function ItemPickerModal({ data, mode, onClose, onPick }) {
  const [entity, setEntity] = useState('ingredient')
  const [query, setQuery] = useState('')
  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    return data[entity].filter((item) => !q || item.name.toLowerCase().includes(q)).slice(0, 30)
  }, [data, entity, query])

  return (
    <div className="payment-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className="payment-modal ivm-picker-modal" role="dialog" aria-modal="true" aria-labelledby="ivm-picker-title">
        <button className="payment-modal-close" type="button" onClick={onClose} aria-label="Close">×</button>
        <span className="payment-modal-kicker">{mode === 'restock' ? 'Receive stock' : 'Record adjustment'}</span>
        <h2 id="ivm-picker-title">Choose an item</h2>
        <div className="ivm-picker-controls">
          <select value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Item type">
            {TABS.map((tab) => <option key={tab.key} value={tab.key}>{tab.label}</option>)}
          </select>
          <label className="ops-search">
            <Search size={16} /><span className="sr-only">Search items</span>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search by name…" autoFocus />
          </label>
        </div>
        <ul className="ivm-picker-list">
          {list.length === 0 ? <li className="ivm-picker-empty">No items found.</li> : list.map((item) => {
            const status = stockStatus(item)
            return (
              <li key={item.id}>
                <button type="button" onClick={() => onPick(item)}>
                  <b>{item.name}</b>
                  <span>{formatQty(item.quantity)} {item.unit}</span>
                  <span className={`inv-status tone-${STATUS_META[status].tone}`}>{STATUS_META[status].label}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </section>
    </div>
  )
}

function RecipeEditorModal({ product, ingredients, onClose, onSave }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchMenuItemRecipe(product.id)
      .then((existing) => {
        if (!active) return
        setRows(existing.map((row) => ({ ingredientId: row.ingredient_id, quantityPerServing: String(row.quantity_per_serving ?? '') })))
      })
      .catch((cause) => { if (active) setError(describeError(cause, 'Could not load the current recipe.')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [product.id])

  const usedIds = new Set(rows.map((row) => row.ingredientId))
  const addRow = () => {
    const firstFree = ingredients.find((ingredient) => !usedIds.has(ingredient.id))
    if (!firstFree) return
    setRows((current) => [...current, { ingredientId: firstFree.id, quantityPerServing: '' }])
  }
  const updateRow = (index, patch) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const removeRow = (index) => setRows((current) => current.filter((_, i) => i !== index))

  const submit = async (event) => {
    event.preventDefault()
    for (const row of rows) {
      const qty = Number(row.quantityPerServing)
      if (!row.ingredientId) return setError('Every line needs an ingredient.')
      if (row.quantityPerServing === '' || Number.isNaN(qty) || qty <= 0) return setError('Every quantity must be greater than zero.')
    }
    const ids = rows.map((row) => row.ingredientId)
    if (new Set(ids).size !== ids.length) return setError('The same ingredient appears more than once.')
    setSaving(true); setError('')
    try {
      await onSave(product.id, rows.map((row) => ({ ingredientId: row.ingredientId, quantityPerServing: Number(row.quantityPerServing) })))
    } catch (cause) {
      setError(describeError(cause, 'Could not save this recipe.'))
      setSaving(false)
    }
  }

  return (
    <div className="payment-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !saving) onClose() }}>
      <section className="payment-modal ivm-recipe-modal" role="dialog" aria-modal="true" aria-labelledby="ivm-recipe-title">
        <button className="payment-modal-close" type="button" onClick={onClose} disabled={saving} aria-label="Close">×</button>
        <span className="payment-modal-kicker">Recipe mapping</span>
        <h2 id="ivm-recipe-title">{product.name}</h2>
        <p className="ivm-recipe-hint">Quantities are per serving, in each ingredient&apos;s own unit. Completed orders deduct these amounts automatically.</p>
        {loading ? <p className="ops-proof-pending">Loading current recipe…</p> : (
          <form onSubmit={submit}>
            {rows.length === 0 && <p className="ops-proof-pending">No ingredients assigned yet. Add the first line below.</p>}
            {rows.map((row, index) => {
              const ingredient = ingredients.find((i) => i.id === row.ingredientId)
              return (
                <div className="ivm-recipe-edit-row" key={`${row.ingredientId}-${index}`}>
                  <select value={row.ingredientId} onChange={(e) => updateRow(index, { ingredientId: e.target.value })} aria-label="Ingredient">
                    {ingredients.filter((i) => i.id === row.ingredientId || !usedIds.has(i.id)).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                  </select>
                  <input type="number" min="0" step="any" value={row.quantityPerServing} onChange={(e) => updateRow(index, { quantityPerServing: e.target.value })} placeholder="Qty" aria-label="Quantity per serving" required />
                  <span className="ivm-recipe-unit">{ingredient?.unit || ''}</span>
                  <button type="button" className="ops-icon-button small" aria-label="Remove ingredient line" onClick={() => removeRow(index)}><X size={14} /></button>
                </div>
              )
            })}
            <button type="button" className="ops-secondary-action compact ivm-recipe-add" onClick={addRow} disabled={rows.length >= ingredients.length}><Plus size={14} /> Add ingredient</button>
            {error && <p className="form-error">{error}</p>}
            <div className="payment-modal-actions">
              <button className="secondary-button" type="button" onClick={onClose} disabled={saving}>Cancel</button>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save Recipe'}</button>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}

function ItemDrawer({ config, item, usage, supplyUsage = [], onClose, onReceive, onAdjust, onEdit }) {
  const [movements, setMovements] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const status = stockStatus(item)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetchMovements(config.key, item.id)
      .then((rows) => { if (active) { setMovements(rows); setLoadError('') } })
      .catch((cause) => { if (active) setLoadError(describeError(cause, 'Could not load item history.')) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [config.key, item.id])

  return (
    <div className="ops-drawer-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <aside className="ops-drawer ivm-drawer" role="dialog" aria-modal="true" aria-labelledby="inv-drawer-title">
        <header>
          <div><span className="settings-kicker">{config.singular}</span><h2 id="inv-drawer-title">{item.name}</h2></div>
          <button type="button" onClick={onClose} aria-label="Close item details"><X size={20} /></button>
        </header>
        <div className="ops-drawer-body">
          <section className="ivm-drawer-stock">
            <div>
              <span>Current stock</span>
              <b>{formatQty(item.quantity)} {item.unit}</b>
            </div>
            <span className={`inv-status tone-${STATUS_META[status].tone}`}>{STATUS_META[status].label}</span>
          </section>
          <section className="ivm-drawer-grid">
            <div><span>Warning level</span><b>{formatQty(item.minStockLevel)} {item.unit}</b></div>
            <div><span>Reorder level</span><b>{item.highStockLevel > 0 ? `${formatQty(item.highStockLevel)} ${item.unit}` : '—'}</b></div>
            <div><span>Category</span><b>{item.category || '—'}</b></div>
            {config.hasType && <div><span>Type</span><b className="inv-capitalize">{item.type}</b></div>}
            {item.supplier && <div><span>Supplier</span><b>{item.supplier}</b></div>}
            <div><span>Last updated</span><b>{timeAgo(item.updatedAt)}</b></div>
          </section>
          {item.notes && <section><h3>Notes</h3><p>{item.notes}</p></section>}
          {config.key === 'supply' && (
            <section>
              <h3>Used by products {supplyUsage.length > 0 && <i className="ivm-tab-flag">{supplyUsage.length}</i>}</h3>
              {supplyUsage.length === 0 ? (
                <p className="ops-proof-pending">Not connected to any product. This supply is counted manually — use Receive Stock and Record Adjustment to keep it accurate.</p>
              ) : (
                <ul className="ivm-recipe-lines ivm-drawer-usage">
                  {supplyUsage.map((entry) => (
                    <li key={entry.id}>
                      <b>{entry.product ? entry.product.name : 'Whole order'}</b>
                      <span>{formatQty(entry.quantityPerServing)} {item.unit}</span>
                      <span className="ivm-cond-chip">{conditionLabel(entry)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          {config.key === 'ingredient' && (
            <section>
              <h3>Used by products {usage.length > 0 && <i className="ivm-tab-flag">{usage.length}</i>}</h3>
              {usage.length === 0 ? <p className="ops-proof-pending">Not used in any product recipe yet.</p> : (
                <ul className="ivm-recipe-lines ivm-drawer-usage">
                  {usage.map((entry) => (
                    <li key={entry.menuItemId}>
                      <b>{entry.product?.name || 'Unknown product'}</b>
                      <span>{formatQty(entry.quantityPerServing || 0)} {item.unit} per serving</span>
                      {entry.product && !entry.product.isAvailable && <span className="inv-status tone-amber">Unavailable</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          <section>
            <h3>Recent stock movements</h3>
            {loadError && <p className="form-error">{loadError}</p>}
            {loading ? (
              <div className="inv-skeleton">{Array.from({ length: 3 }).map((_, i) => <div className="inv-skeleton-row ivm-skel-thin" key={i} />)}</div>
            ) : movements.length === 0 ? <p className="ops-proof-pending">No stock movements recorded yet.</p> : (
              <ul className="inv-movement-list">
                {movements.map((movement) => (
                  <li key={movement.id}>
                    <span className={`inv-movement-type ${movement.movement_type}`}>{/^Order /.test(movement.reason || '') ? 'order' : movement.movement_type}</span>
                    <b>{movement.movement_type === 'restock' ? '+' : '−'}{formatQty(movement.quantity)} {item.unit}</b>
                    <span className="inv-movement-meta">{movement.reason || 'No reason given'} · {movement.staffName} · {timeAgo(movement.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
        <footer className="ops-drawer-footer">
          <button type="button" className="ops-main-action" onClick={onReceive}><PackagePlus size={16} /> Receive Stock</button>
          <button type="button" className="ops-secondary-action" onClick={onAdjust}><PackageMinus size={16} /> Adjust</button>
          <button type="button" className="ops-secondary-action" onClick={onEdit}><Pencil size={16} /> Edit</button>
        </footer>
      </aside>
    </div>
  )
}
