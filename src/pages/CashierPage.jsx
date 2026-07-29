import {
  Banknote,
  CreditCard,
  Expand,
  Landmark,
  LogOut,
  Minus,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  ShoppingBag,
  Wallet,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { menuItems, store } from '../data/mockData'
import { getCurrentPortalSession, signOutPortal } from '../lib/auth'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

const paymentMethods = [
  { value: 'Cash', label: 'Cash', icon: Banknote },
  { value: 'GCash', label: 'GCash', icon: Wallet },
  { value: 'Bank Transfer', label: 'Bank Transfer', icon: Landmark },
]

const peso = (value) => `PHP ${Number(value || 0).toFixed(2)}`
const defaultAddonOptions = [
  { name: 'Espresso Shot', price: 30 },
  { name: 'Oat Milk', price: 35 },
  { name: 'Almond Milk', price: 35 },
  { name: 'Soy Milk', price: 30 },
  { name: 'Coffee Jelly', price: 20 },
  { name: 'Whipped Cream', price: 25 },
]

const addonLabel = (addon) => `${addon.name} +${peso(addon.price)}`
const addonTotal = (addons = []) => addons.reduce((sum, addon) => sum + Number(addon.price || 0), 0)
const baseUnitPrice = (item) => Number(item.customizations?.variantPrice ?? item.price ?? 0)
const lineUnitPrice = (item) => baseUnitPrice(item) + addonTotal(item.addons)
const itemLineTotal = (item) => lineUnitPrice(item) * Number(item.qty || item.quantity || 0)
const emptyDiscount = () => ({ enabled: false, type: '', customerName: '', idNumber: '' })
const emptyPayment = () => ({ method: 'Cash', cashReceived: '', referenceNumber: '', accountNumber: '09', bankName: '' })
const createOrderTab = (index = 1) => ({
  id: `WI-${String(index).padStart(3, '0')}`,
  cart: [],
  customerName: '',
  discount: emptyDiscount(),
  payment: emptyPayment(),
})

const makeLineKey = (item, customizations = {}, addons = []) => [
  item.id,
  item.name,
  customizations.temperature || '',
  customizations.sugarLevel || '',
  customizations.iceLevel || '',
  customizations.variantKey || customizations.variantLabel || '',
  addons.map(addonLabel).join('|'),
].join('-').toLowerCase().replace(/\s+/g, '-')

const menuSelectBase = 'id,main_category_id,subcategory_id,item_type,name,slug,description,price,image_url,is_available,is_archived,allow_addons,allow_sugar,allow_ice,temperature_type,sort_order,subcategories(display_name,name),main_categories(display_name,name)'
const menuSelectWithVariants = menuSelectBase.replace('temperature_type,', 'temperature_type,variant_options,')

async function loadMenuItems() {
  const withVariants = await supabase.from('menu_items').select(menuSelectWithVariants).eq('is_archived', false).order('sort_order', { ascending: true })
  if (!withVariants.error || !/variant_options/i.test(withVariants.error.message || '')) return withVariants
  return supabase.from('menu_items').select(menuSelectBase).eq('is_archived', false).order('sort_order', { ascending: true })
}
const fallbackImage = '/images/coffeerealmlogo.png'

function resolveImagePath(path) {
  if (!path) return fallbackImage
  if (/^https?:\/\//i.test(path)) return path
  return path.startsWith('/') ? path : `/${path}`
}
function truthy(value) {
  return value === true || value === 1 || value === '1' || value === 'true'
}

function parseVariantConfig(value) {
  if (!value) return {}
  if (typeof value === 'string') {
    try {
      return JSON.parse(value)
    } catch {
      return {}
    }
  }
  return value
}

function normalizeTemperatureType(value) {
  const type = String(value || '').toLowerCase().replace(/\s+/g, '_')
  if (['hot', 'hot_only'].includes(type)) return 'hot'
  if (['cold', 'cold_only', 'iced', 'iced_only'].includes(type)) return 'cold'
  if (['both', 'flexible', 'hot_cold', 'hot_and_cold'].includes(type)) return 'both'
  return ''
}

function variantOptionsFromConfig(config, product) {
  const labels = config?.labels || {}
  const prices = config?.prices || {}
  return Object.entries(labels).map(([key, label]) => ({
    key,
    label,
    price: Number(prices[key] ?? product.price ?? 0),
  })).filter((option) => option.label && option.price > 0)
}

function productOptionDefaults(product) {
  const variantConfig = parseVariantConfig(product.variantConfig)
  const variantOptions = variantOptionsFromConfig(variantConfig, product)
  const text = `${product.itemType || ''} ${product.category || ''} ${product.name || ''}`.toLowerCase()
  const temperatureType = normalizeTemperatureType(product.temperatureType)
  const isFood = /meal|meals|pasta|rice|sandwich|snack|nachos|cake|cookie|cookies|cheesecake|tiramisu/.test(text)
  const isDrink = !isFood && (/drink|drinks|coffee|tea|latte|frappe|americano|espresso|milk|mocha|cappuccino|macchiato|smoothie|juice|chocolate/.test(text) || ['drink', 'drinks', 'beverage'].includes(String(product.itemType || '').toLowerCase()))
  const inferredTemperature = temperatureType || (isDrink ? (/iced|cold|frappe|smoothie|juice/.test(text) ? 'cold' : 'both') : '')

  if (variantOptions.length) {
    return {
      allowSugar: false,
      allowIce: false,
      allowAddons: truthy(product.allowAddons) || isFood,
      temperatureType: '',
      variantConfig,
      variantOptions,
    }
  }

  return {
    allowSugar: truthy(product.allowSugar) || isDrink,
    allowIce: truthy(product.allowIce) || ['cold', 'both'].includes(inferredTemperature),
    allowAddons: truthy(product.allowAddons) || isDrink || isFood,
    temperatureType: inferredTemperature,
    variantConfig,
    variantOptions,
  }
}
function normalizeProduct(row) {
  const product = {
    id: row.id,
    name: row.name || row.product_name || 'Menu item',
    category: row.subcategories?.display_name || row.subcategories?.name || row.category_name || row.subcategory || row.main_categories?.display_name || row.main_categories?.name || row.main_category || 'Menu',
    description: row.description || '',
    price: Number(row.price || row.unit_price || 0),
    image: resolveImagePath(row.image_url || row.image_path || row.image),
    isAvailable: row.is_available ?? row.available ?? row.status !== 'unavailable',
    itemType: row.item_type || row.type || '',
    allowSugar: row.allow_sugar ?? row.allowSugar,
    allowIce: row.allow_ice ?? row.allowIce,
    allowAddons: row.allow_addons ?? row.allowAddons,
    temperatureType: row.temperature_type || row.temperatureType || '',
    variantConfig: parseVariantConfig(row.variant_options || row.variantOptions),
  }
  return { ...product, ...productOptionDefaults(product) }
}

function normalizeOrder(row) {
  const items = row.order_items || row.items || []
  const payment = Array.isArray(row.payments) ? row.payments[0] : row.payment
  return {
    id: row.id,
    orderNumber: row.order_number || row.reference_code || `Walk-in #${row.id}`,
    customerName: row.customer_name || row.full_name || 'Walk-in Customer',
    subtotal: Number(row.subtotal || row.discount_subtotal || row.final_total || 0),
    discountAmount: Number(row.discount_amount || 0),
    discountType: row.discount_type || '',
    total: Number(row.final_total || row.subtotal || 0),
    paymentMethod: payment?.method || row.payment_method || 'Cash',
    paymentReference: payment?.reference_number || row.payment_reference || '',
    bankName: payment?.bank_name || row.bank_name || '',
    cashReceived: Number(payment?.amount_received ?? row.amount_received ?? 0),
    change: Number(payment?.change_amount ?? row.change_amount ?? 0),
    discountCustomerName: row.discount_customer_name || '',
    discountIdNumber: row.discount_id_number || '',
    createdAt: row.created_at,
    items,
  }
}

function validatePayment(payment, total) {
  if (payment.method === 'Cash') {
    const received = Number(payment.cashReceived || 0)
    if (!payment.cashReceived || received < total) return 'Amount paid must be equal to or greater than the total.'
  }
  if (payment.method === 'GCash') {
    if (!/^\d{13}$/.test(payment.referenceNumber || '')) return 'GCash reference number must be exactly 13 digits.'
  }
  if (payment.method === 'Bank Transfer') {
    if (!payment.bankName.trim()) return 'Bank name is required for bank transfer.'
    if (!/^[A-Za-z0-9-]{6,30}$/.test(payment.referenceNumber || '')) return 'Bank transfer reference must be 6 to 30 letters, numbers, or hyphens.'
  }
  return ''
}

export default function CashierPage() {
  const navigate = useNavigate()
  const fallbackProducts = useMemo(() => menuItems.map((item) => ({
    ...item,
    price: Number(item.price || 0),
    isAvailable: Boolean(item.price),
    itemType: item.itemType || item.category || '',
    ...productOptionDefaults({ ...item, itemType: item.itemType || item.category || '' }),
  })), [])
  const [products, setProducts] = useState(fallbackProducts)
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(Boolean(isSupabaseConfigured))
  const [notice, setNotice] = useState('')
  const [category, setCategory] = useState('All')
  const [search, setSearch] = useState('')
  const [orderTabs, setOrderTabs] = useState(() => [createOrderTab(1)])
  const [activeOrderId, setActiveOrderId] = useState('WI-001')
  const [receipt, setReceipt] = useState(null)
  const [customizingProduct, setCustomizingProduct] = useState(null)
  const [showTransactions, setShowTransactions] = useState(false)
  const [transactionDetails, setTransactionDetails] = useState(null)
  const [showCheckout, setShowCheckout] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [error, setError] = useState('')
  const [cashierProfile, setCashierProfile] = useState(null)

  useEffect(() => {
    let ignore = false
    async function loadCashierData() {
      const { profile } = await getCurrentPortalSession()
      if (!ignore) setCashierProfile(profile)
      if (!isSupabaseConfigured) {
        setNotice('Supabase is not configured yet, showing local sample menu.')
        setLoading(false)
        return
      }
      setLoading(true)
      const [productResult, orderResult] = await Promise.all([
        loadMenuItems(),
        supabase.from('orders').select('id,order_number,customer_name,subtotal,discount_amount,final_total,payment_status,payment_confirmed,discount_type,discount_customer_name,discount_id_number,created_at,order_items(*),payments(*)').eq('order_type', 'walk-in').order('created_at', { ascending: false }).limit(30),
      ])
      if (ignore) return
      if (!productResult.error && productResult.data?.length) {
        setProducts(productResult.data.map(normalizeProduct))
        setNotice('')
      } else {
        setProducts(fallbackProducts)
        setNotice(productResult.error ? `Using local menu because Supabase menu_items could not load: ${productResult.error.message}` : 'No Supabase menu items found yet, showing local menu.')
      }
      if (!orderResult.error && orderResult.data) setTransactions(orderResult.data.map(normalizeOrder))
      setLoading(false)
    }
    loadCashierData()
    async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      setError('Fullscreen is not available in this browser.')
    }
  }
  return () => {
      ignore = true
    }
  }, [fallbackProducts])

  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', syncFullscreen)
    async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      setError('Fullscreen is not available in this browser.')
    }
  }
  return () => document.removeEventListener('fullscreenchange', syncFullscreen)
  }, [])
  const activeOrder = orderTabs.find((tab) => tab.id === activeOrderId) || orderTabs[0] || createOrderTab(1)
  const cart = activeOrder.cart
  const customerName = activeOrder.customerName
  const discount = activeOrder.discount
  const payment = activeOrder.payment

  function updateActiveOrder(updater) {
    setOrderTabs((current) => current.map((tab) => tab.id === activeOrder.id ? { ...tab, ...updater(tab) } : tab))
  }

  function setCart(updater) {
    updateActiveOrder((tab) => ({ cart: typeof updater === 'function' ? updater(tab.cart) : updater }))
  }

  function setCustomerName(value) {
    updateActiveOrder(() => ({ customerName: value }))
  }

  function setDiscount(updater) {
    updateActiveOrder((tab) => ({ discount: typeof updater === 'function' ? updater(tab.discount) : updater }))
  }

  function setPayment(updater) {
    updateActiveOrder((tab) => ({ payment: typeof updater === 'function' ? updater(tab.payment) : updater }))
  }
  const categories = useMemo(() => ['All', ...Array.from(new Set(products.map((item) => item.category).filter(Boolean)))], [products])
  const filteredProducts = useMemo(() => products.filter((item) => {
    const matchesCategory = category === 'All' || item.category === category
    const haystack = `${item.name} ${item.description} ${item.category}`.toLowerCase()
    return matchesCategory && haystack.includes(search.trim().toLowerCase())
  }), [category, products, search])
  const subtotal = cart.reduce((sum, item) => sum + itemLineTotal(item), 0)
  const discountSubtotal = discount.enabled ? subtotal : 0
  const discountAmount = discount.enabled ? discountSubtotal * 0.2 : 0
  const total = Math.max(0, subtotal - discountAmount)
  const change = payment.method === 'Cash' ? Math.max(0, Number(payment.cashReceived || 0) - total) : 0
  const cashierName = cashierProfile?.full_name || cashierProfile?.username || cashierProfile?.email || 'Cashier'
  const cartCount = cart.reduce((sum, item) => sum + item.qty, 0)

  function openNewOrderTab() {
    setOrderTabs((current) => {
      if (current.length >= 3) return current
      const nextIndex = Math.max(0, ...current.map((tab) => Number(tab.id.replace('WI-', '')) || 0)) + 1
      const nextTab = createOrderTab(nextIndex)
      setActiveOrderId(nextTab.id)
      return [...current, nextTab]
    })
  }

  function closeOrderTab(tabId) {
    const target = orderTabs.find((tab) => tab.id === tabId)
    if (!target) return
    if (target.cart.length && !window.confirm(`Close ${target.id}? This order has items in the cart.`)) return
    setOrderTabs((current) => {
      if (current.length === 1) {
        const fresh = createOrderTab(1)
        setActiveOrderId(fresh.id)
        return [fresh]
      }
      const nextTabs = current.filter((tab) => tab.id !== tabId)
      if (activeOrderId === tabId) setActiveOrderId(nextTabs[0].id)
      return nextTabs
    })
  }

  function shouldCustomize(product) {
    return true
  }

  function addConfiguredItem(product, customizations = {}, addons = [], quantity = 1) {
    if (!product.price || !product.isAvailable) return
    setCart((current) => {
      const lineKey = makeLineKey(product, customizations, addons)
      const existing = current.find((item) => item.lineKey === lineKey)
      if (existing) return current.map((item) => item.lineKey === lineKey ? { ...item, qty: Math.min(99, item.qty + quantity) } : item)
      return [...current, { ...product, lineKey, qty: quantity, isDiscounted: false, customizations, addons }]
    })
  }

  function addToCart(product) {
    if (!product.price || !product.isAvailable) return
    if (shouldCustomize(product)) {
      setCustomizingProduct(product)
      return
    }
    addConfiguredItem(product)
  }
  function changeQty(lineKey, delta) {
    setCart((current) => current.map((item) => item.lineKey === lineKey ? { ...item, qty: item.qty + delta } : item).filter((item) => item.qty > 0))
  }

  function editCartItem(item) {
    setCustomizingProduct(item)
  }

  function updateConfiguredItem(item, customizations, addons, quantity) {
    setCart((current) => {
      const withoutOriginal = current.filter((line) => line.lineKey !== item.lineKey)
      const lineKey = makeLineKey(item, customizations, addons)
      const existing = withoutOriginal.find((line) => line.lineKey === lineKey)
      if (existing) return withoutOriginal.map((line) => line.lineKey === lineKey ? { ...line, qty: line.qty + quantity } : line)
      return [...withoutOriginal, { ...item, lineKey, qty: quantity, customizations, addons }]
    })
  }
  async function saveOrder() {
    setError('')
    if (!cart.length) return setError('Add at least one item to the cart.')
    if (discount.enabled) {
      if (!['PWD', 'Senior'].includes(discount.type)) return setError('Select PWD or Senior discount type.')
      if (!discount.customerName.trim() || !discount.idNumber.trim()) return setError('Discount customer name and ID number are required.')
    }
    const validationError = validatePayment(payment, total)
    if (validationError) return setError(validationError)
    if (!cashierProfile?.id) return setError('Cashier login is required before saving an order.')
    const orderSequence = Math.floor(Date.now() / 1000)
    const orderDraft = {
      id: Date.now(),
      orderNumber: `WI-${orderSequence}`,
      customerName: customerName.trim() || 'Walk-in Customer',
      subtotal,
      discountAmount,
      paymentMethod: payment.method,
      paymentReference: payment.method !== 'Cash' ? payment.referenceNumber : '',
      accountNumber: '',
      bankName: payment.method === 'Bank Transfer' ? payment.bankName : '',
      cashReceived: payment.method === 'Cash' ? Number(payment.cashReceived || total) : total,
      change,
      discountType: discount.enabled ? discount.type : '',
      discountCustomerName: discount.enabled ? discount.customerName : '',
      discountIdNumber: discount.enabled ? discount.idNumber : '',
      discountSubtotal,
      cashierName: cashierProfile?.full_name || cashierProfile?.username || cashierProfile?.email || 'Cashier',
      total,
      createdAt: new Date().toISOString(),
      items: cart.map((item) => ({ ...item, unitPrice: lineUnitPrice(item), line_total: itemLineTotal(item) })),
    }

    if (!isSupabaseConfigured) {
      setTransactions((current) => [orderDraft, ...current])
      setReceipt(orderDraft)
      setCart([])
      return true
    }

    const orderPayload = {
      order_number: orderDraft.orderNumber,
      order_sequence: orderSequence,
      order_source: 'cashier_pos',
      cashier_id: cashierProfile.id,
      order_type: 'walk-in',
      status: 'Ordered',
      customer_name: orderDraft.customerName,
      subtotal,
      discount_type: discount.enabled ? discount.type : null,
      discount_customer_name: discount.enabled ? discount.customerName : null,
      discount_id_number: discount.enabled ? discount.idNumber : null,
      discount_subtotal: discount.enabled ? discountSubtotal : 0,
      discount_amount: discountAmount,
      final_total: total,
      payment_status: 'paid',
      payment_confirmed: true,
    }

    const orderItems = cart.map((item) => ({
      menu_item_id: item.id,
      item_name: item.name,
      unit_price: lineUnitPrice(item),
      quantity: item.qty,
      line_total: itemLineTotal(item),
      is_discounted: Boolean(item.isDiscounted),
      discount_amount: item.isDiscounted ? itemLineTotal(item) * 0.2 : 0,
      customizations: item.customizations || {},
      addons: item.addons || [],
    }))
    const paymentMethodCode = { Cash: 'cash', GCash: 'gcash', 'Bank Transfer': 'bank_transfer' }[payment.method] || 'cash'
    const paymentPayload = {
      method: paymentMethodCode,
      amount_due: total,
      amount_received: payment.method === 'Cash' ? Number(payment.cashReceived || total) : total,
      change_amount: change,
      reference_number: payment.method !== 'Cash' ? payment.referenceNumber : null,
      account_number: null,
      bank_name: payment.method === 'Bank Transfer' ? payment.bankName : null,
      status: 'paid',
      paid_at: new Date().toISOString(),
    }
    const { data: savedOrder, error: orderError } = await supabase.rpc('create_cashier_order', {
      request_payload: { order: orderPayload, items: orderItems, payment: paymentPayload },
    })
    if (orderError) return setError(`Order was not saved: ${orderError.message}`)

    const saved = { ...orderDraft, id: savedOrder.id, orderNumber: savedOrder.order_number || orderDraft.orderNumber, subtotal: Number(savedOrder.subtotal), discountAmount: Number(savedOrder.discount_amount), total: Number(savedOrder.total), change: Number(savedOrder.change_amount) }
    setTransactions((current) => [saved, ...current])
    setReceipt(saved)
    setCart([])
    setCustomerName('')
    setDiscount(emptyDiscount())
    setPayment(emptyPayment())
    return true
  }
  async function logout() {
    await signOutPortal()
    navigate('/portal', { replace: true })
  }

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      setError('Fullscreen is not available in this browser.')
    }
  }
  async function openTransactionDetails(order) {
    if (order.items?.length || !isSupabaseConfigured || !order.id) {
      setTransactionDetails(order)
      return
    }
    const { data, error: detailsError } = await supabase.from('order_items').select('*').eq('order_id', order.id).order('id')
    setTransactionDetails({ ...order, items: detailsError ? [] : (data || []) })
  }
  return (
    <div className={`cashier-v2 legacy-cashier ${isFullscreen ? 'cashier-is-fullscreen' : ''}`}>
      <header className="legacy-cashier-top">
        <div className="cashier-top-left">
          <img src="/images/coffeerealmlogo.png" alt="thecoffeerealm logo" />
          <div><span className="cashier-kicker">Walk-in point of sale</span><strong>the coffee realm</strong></div>
        </div>
        <div className="cashier-time">
          <span>{new Date().toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</span>
          <b>{new Date().toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' })}</b>
        </div>
        <nav>
          <button type="button" onClick={() => setShowTransactions(true)}><ReceiptText size={21} /><span>transactions</span></button>
          <button type="button" onClick={logout}><LogOut size={21} /><span>logout</span></button>
        </nav>
      </header>

      <main className="legacy-pos-layout cashier-live-pos">
        <section className="legacy-pos-menu">
          <div className="cashier-workspace-tabs">
            <div className="cashier-order-tabs-list">
              {orderTabs.map((tab) => <div className={`cashier-order-tab ${tab.id === activeOrderId ? 'active' : ''}`} key={tab.id}>
                <button type="button" className="cashier-tab-select" onClick={() => setActiveOrderId(tab.id)}>{tab.id}</button>
                <button type="button" className="cashier-tab-close" onClick={() => closeOrderTab(tab.id)} aria-label={`Close ${tab.id}`}>&times;</button>
              </div>)}
            </div>
          </div>
          <div className="legacy-pos-heading">
            <div>
              <div className="cashier-menu-title-row"><div className="cashier-menu-title"><h1>Menu</h1><button type="button" className="cashier-fullscreen" onClick={toggleFullscreen} aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}><Expand size={16} /> <span>{isFullscreen ? 'Exit Fullscreen' : 'Enter Fullscreen'}</span></button></div><div className="cashier-menu-actions"><button type="button" className="cashier-new-order" onClick={openNewOrderTab} disabled={orderTabs.length >= 3}><Plus size={18} /> New Order</button></div></div>
            </div>
            
          </div>
          {notice ? <div className="cashier-sync-note">{notice}</div> : null}
          <div className="cashier-menu-controls"><label><Search size={18} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search menu items" /></label><CategoryTabs categories={categories} active={category} onChange={setCategory} /></div>
          <ProductGrid products={filteredProducts} onAdd={addToCart} />
          {!loading && filteredProducts.length === 0 ? <div className="cashier-empty-state"><Search size={28} /><b>No menu items found</b><span>Try another category or search term.</span></div> : null}
        </section>

        <aside className="legacy-ticket">
          <header>
            <div><span className="cashier-order-icon"><ShoppingBag size={18} /></span><span><small>Current order</small><b>{activeOrder.id}</b></span></div>
            <button type="button" className="cashier-clear-cart" onClick={() => setCart([])}>Clear Cart</button>
          </header>
          <div className="cashier-cart-count"><span>Items</span><b>{cartCount}</b></div>
          <POSCart cart={cart} onQty={changeQty} onEdit={editCartItem} />
          <div className="cashier-checkout-block">
            <OrderSummary subtotal={subtotal} total={total} />
            {error ? <div className="cashier-error">{error}</div> : null}
            <button type="button" className="legacy-charge" onClick={() => setShowCheckout(true)} disabled={!cart.length}>Checkout</button>
          </div>
        </aside>
      </main>

      {showCheckout ? <CheckoutModal cart={cart} subtotal={subtotal} total={total} discount={discount} setDiscount={setDiscount} payment={payment} setPayment={setPayment} change={change} error={error} onCancel={() => { setShowCheckout(false); setError('') }} onConfirm={async () => { if (await saveOrder()) setShowCheckout(false) }} /> : null}
      {customizingProduct ? <ItemCustomizationModal product={customizingProduct} onClose={() => setCustomizingProduct(null)} onAdd={(customizations, addons, quantity) => { updateConfiguredItem(customizingProduct, customizations, addons, quantity); setCustomizingProduct(null) }} /> : null}
      {showTransactions ? <CashierTransactionsModal transactions={transactions} onClose={() => setShowTransactions(false)} onViewDetails={openTransactionDetails} onOpenReceipt={(order) => { setReceipt(order); setShowTransactions(false) }} /> : null}
      {transactionDetails ? <TransactionDetailsModal order={transactionDetails} onBack={() => setTransactionDetails(null)} onClose={() => { setTransactionDetails(null); setShowTransactions(false) }} /> : null}
      {receipt ? <CashierReceipt order={receipt} onClose={() => setReceipt(null)} /> : null}
    </div>
  )
}

function CategoryTabs({ categories, active, onChange }) {
  return <div className="legacy-pos-tabs">{categories.map((item) => <button type="button" className={item === active ? 'active' : ''} key={item} onClick={() => onChange(item)}>{item}</button>)}</div>
}

function ProductGrid({ products, onAdd }) {
  return <div className="legacy-pos-products">{products.map((item) => {
    const hasOptions = Boolean(item.allowSugar || item.allowIce || item.allowAddons || item.temperatureType || item.variantOptions?.length)
    return <article key={item.id} className={!item.price || !item.isAvailable ? 'unpriced' : 'cashier-product-card'} role={!item.price || !item.isAvailable ? undefined : 'button'} tabIndex={!item.price || !item.isAvailable ? undefined : 0} onClick={() => { if (item.price && item.isAvailable) onAdd(item) }} onKeyDown={(event) => { if (item.price && item.isAvailable && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onAdd(item) } }}>
      <img src={item.image} alt={item.name} />
      <div className="cashier-product-body">
        <small>{item.category}{hasOptions ? ' / Customizable' : ''}</small>
        <h3>{item.name}</h3>        <footer>
          <strong>{item.price ? peso(item.price) : 'No price set'}</strong>
          <button type="button" disabled={!item.price || !item.isAvailable} onClick={(event) => { event.stopPropagation(); onAdd(item) }} aria-label={`Add ${item.name}`}><Plus size={18} /></button>
        </footer>
      </div>
    </article>
  })}</div>
}

function POSCart({ cart, onQty, onEdit }) {
  return <div className="legacy-ticket-items">{cart.length === 0 ? <p>No items added yet.</p> : cart.map((item) => {
    const editable = Boolean(item.allowSugar || item.allowIce || item.allowAddons || item.temperatureType || item.variantOptions?.length)
    return <article key={item.lineKey}>
      <img src={item.image} alt={item.name} />
      <div className="cashier-line-body">
        <div className="cashier-line-top">
          <div>
            <b>{item.name}</b>
            <small>{item.category}</small>
            <CustomizationSummary item={item} />
          </div>
          <div className="cashier-line-price-actions">
            <strong>{peso(itemLineTotal(item))}</strong>
          </div>
        </div>
        <div className="cashier-line-bottom">
          <span className="cashier-qty-stepper"><button type="button" onClick={() => onQty(item.lineKey, -1)}><Minus size={13} /></button>{item.qty}<button type="button" onClick={() => onQty(item.lineKey, 1)}><Plus size={13} /></button></span>
          <span className="cashier-line-bottom-actions">
            {editable ? <button type="button" className="cashier-edit-line" onClick={() => onEdit(item)}><Pencil size={14} /> Edit</button> : null}
          </span>
        </div>
      </div>
    </article>
  })}</div>
}

function customizationDetails(item) {
  return [item.customizations?.variantLabel, item.customizations?.temperature, item.customizations?.sugarLevel, item.customizations?.iceLevel, ...(item.addons || []).map(addonLabel)].filter(Boolean)
}
function CustomizationSummary({ item }) {
  const details = customizationDetails(item)
  if (!details.length) return null
  return <em className="cashier-custom-summary">{details.join(' / ')}</em>
}


function ItemCustomizationModal({ product, onClose, onAdd }) {
  const variantOptions = product.variantOptions || []
  const existingVariant = variantOptions.find((option) => option.key === product.customizations?.variantKey) || variantOptions[0]
  const temperatureOptions = product.temperatureType === 'hot' ? ['Hot'] : product.temperatureType === 'cold' ? ['Cold'] : product.temperatureType === 'both' ? ['Hot', 'Cold'] : []
  const [selectedVariant, setSelectedVariant] = useState(existingVariant || null)
  const [temperature, setTemperature] = useState(product.customizations?.temperature || (temperatureOptions[0] || ''))
  const isCold = temperature === 'Cold'
  const [sugarLevel, setSugarLevel] = useState(product.customizations?.sugarLevel || (product.allowSugar ? '100% Sugar' : ''))
  const [iceLevel, setIceLevel] = useState(product.customizations?.iceLevel || (product.allowIce && isCold ? 'Default Ice' : ''))
  const [addons, setAddons] = useState(product.addons || [])
  const [quantity, setQuantity] = useState(Number(product.qty || 1))
  const unitTotal = Number(selectedVariant?.price ?? product.price ?? 0) + addonTotal(addons)
  const modalTotal = unitTotal * quantity
  const variantTitle = product.variantConfig?.type === 'cake' ? 'Cake option' : 'Serving option'

  function chooseTemperature(option) {
    setTemperature(option)
    if (option === 'Cold' && product.allowIce && !iceLevel) setIceLevel('Default Ice')
    if (option !== 'Cold') setIceLevel('')
  }

  function toggleAddon(option) {
    setAddons((current) => current.some((item) => item.name === option.name) ? current.filter((item) => item.name !== option.name) : [...current, option])
  }

  function changeQuantity(delta) {
    setQuantity((current) => Math.min(99, Math.max(1, current + delta)))
  }

  function submitItem() {
    onAdd({
      variantKey: selectedVariant?.key || '',
      variantLabel: selectedVariant?.label || '',
      variantPrice: selectedVariant?.price,
      temperature,
      sugarLevel,
      iceLevel,
    }, addons, quantity)
  }

  return <div className="cashier-custom-backdrop" role="dialog" aria-modal="true" aria-label={`Customize ${product.name}`}>
    <section className="cashier-custom-modal modern-pos-modal">
      <header className="cashier-custom-product-head modern-pos-modal-head">
        <img src={product.image} alt={product.name} />
        <div className="modern-pos-product-copy">
          <span>Customize item</span>
          <h2>{product.name}</h2>
          <p>{product.category}</p>
          <strong>{peso(unitTotal)}</strong>
        </div>
        <button type="button" className="modern-pos-close" onClick={onClose} aria-label="Close customization">&times;</button>
      </header>
      <div className="cashier-custom-body modern-pos-modal-body">
        <div className="modern-pos-column">
          {variantOptions.length ? <VariantGroup title={variantTitle} options={variantOptions} value={selectedVariant} onChange={setSelectedVariant} /> : null}
          {temperatureOptions.length ? <OptionGroup title="Temperature" options={temperatureOptions} value={temperature} onChange={chooseTemperature} /> : null}
          {product.allowIce && isCold ? <OptionGroup title="Ice level" options={['Less Ice', 'Default Ice', 'More Ice']} value={iceLevel} onChange={setIceLevel} /> : null}
          {product.allowSugar ? <OptionGroup title="Sugar level" options={['0% Sugar', '25% Sugar', '50% Sugar', '75% Sugar', '100% Sugar']} value={sugarLevel} onChange={setSugarLevel} /> : null}
        </div>
        <div className="modern-pos-column">
          {product.allowAddons ? <div className="cashier-option-group modern-addon-group"><h3>Add-ons</h3><div className="cashier-option-grid cashier-addon-grid modern-addon-list">{defaultAddonOptions.map((option) => {
            const selected = addons.some((item) => item.name === option.name)
            return <button type="button" className={selected ? 'active' : ''} key={option.name} onClick={() => toggleAddon(option)}>
              <span>{selected ? <i>&#10003;</i> : null}{option.name}</span>
              <b>+{peso(option.price)}</b>
            </button>
          })}</div></div> : null}
        </div>
      </div>
      <footer className="modern-pos-summary-bar">
        <div className="modern-quantity-stepper" aria-label="Quantity selector">
          <button type="button" onClick={() => changeQuantity(-1)} aria-label="Decrease quantity"><Minus size={15} /></button>
          <strong>{quantity}</strong>
          <button type="button" onClick={() => changeQuantity(1)} aria-label="Increase quantity"><Plus size={15} /></button>
        </div>
        <div className="modern-modal-total"><span>Total</span><b>{peso(modalTotal)}</b></div>
        <button type="button" className="modern-add-cart" onClick={submitItem}>Add to Cart</button>
      </footer>
    </section>
  </div>
}
function OptionGroup({ title, options, value, onChange }) {
  return <div className="cashier-option-group modern-option-group"><h3>{title}</h3><div className="cashier-option-grid modern-pill-grid">{options.map((option) => <button type="button" className={value === option ? 'active' : ''} key={option} onClick={() => onChange(option)}>{option}</button>)}</div></div>
}
function VariantGroup({ title, options, value, onChange }) {
  return <div className="cashier-option-group modern-option-group"><h3>{title}</h3><div className="cashier-option-grid modern-pill-grid">{options.map((option) => <button type="button" className={value?.key === option.key ? 'active' : ''} key={option.key} onClick={() => onChange(option)}>{option.label}<small>{peso(option.price)}</small></button>)}</div></div>
}function DiscountPanel({ discount, setDiscount }) {
  return <section className="cashier-panel"><label className="cashier-check"><input type="checkbox" checked={discount.enabled} onChange={(event) => setDiscount((current) => ({ ...current, enabled: event.target.checked }))} /> Apply PWD / Senior Discount</label>{discount.enabled ? <div className="cashier-form-grid"><select value={discount.type} onChange={(event) => setDiscount((current) => ({ ...current, type: event.target.value }))}><option value="">Discount type</option><option value="PWD">PWD</option><option value="Senior">Senior</option></select><input value={discount.customerName} onChange={(event) => setDiscount((current) => ({ ...current, customerName: event.target.value }))} placeholder="Customer name" /><input value={discount.idNumber} onChange={(event) => setDiscount((current) => ({ ...current, idNumber: event.target.value }))} placeholder="PWD/Senior ID number" /></div> : null}</section>
}

function PaymentPanel({ payment, setPayment, total, change }) {
  return <section className="cashier-panel"><div className="cashier-payment-methods">{paymentMethods.map(({ value, label, icon: Icon }) => <button type="button" className={payment.method === value ? 'active' : ''} key={value} onClick={() => setPayment((current) => ({ ...current, method: value }))}><Icon size={18} /> {label}</button>)}</div>{payment.method === 'Cash' ? <div className="cashier-form-grid"><input type="number" min={total} step="0.01" value={payment.cashReceived} onChange={(event) => setPayment((current) => ({ ...current, cashReceived: event.target.value }))} placeholder="Cash received" /><input readOnly value={`Change: ${peso(change)}`} /></div> : null}{payment.method === 'GCash' ? <div className="cashier-form-grid"><input value={payment.accountNumber} onChange={(event) => setPayment((current) => ({ ...current, accountNumber: event.target.value.replace(/\D/g, '').slice(0, 11) }))} placeholder="09XXXXXXXXX" /><input value={payment.referenceNumber} onChange={(event) => setPayment((current) => ({ ...current, referenceNumber: event.target.value.replace(/\D/g, '').slice(0, 13) }))} placeholder="13-digit reference" /></div> : null}{payment.method === 'Bank Transfer' ? <div className="cashier-form-grid"><input value={payment.bankName} onChange={(event) => setPayment((current) => ({ ...current, bankName: event.target.value }))} placeholder="Bank name" /><input value={payment.referenceNumber} onChange={(event) => setPayment((current) => ({ ...current, referenceNumber: event.target.value.replace(/[^A-Za-z0-9-]/g, '').slice(0, 30) }))} placeholder="Transfer reference" /></div> : null}</section>
}

function OrderSummary({ subtotal, total }) {
  return <div className="legacy-ticket-total"><p><span>Subtotal</span><b>{peso(subtotal)}</b></p><hr /><p><strong>Total</strong><strong>{peso(total)}</strong></p></div>
}


function CheckoutModal({ cart, subtotal, total, discount, setDiscount, payment, setPayment, change, error, onCancel, onConfirm }) {
  const discountChoices = ['No Discount', 'PWD', 'Senior']
  const paymentChoices = [
    { value: 'Cash', label: 'Cash', icon: Banknote },
    { value: 'GCash', label: 'GCash', icon: Wallet },
    { value: 'Bank Transfer', label: 'Bank', icon: Landmark },
  ]
  const activeDiscount = discount.enabled ? discount.type : 'No Discount'

  function chooseDiscount(choice) {
    if (choice === 'No Discount') {
      setDiscount(emptyDiscount())
      return
    }
    setDiscount((current) => ({ ...current, enabled: true, type: choice }))
  }

  return <div className="checkout-backdrop" role="dialog" aria-modal="true" aria-labelledby="checkout-title">
    <section className="checkout-modal">
      <header className="checkout-modal-head">
        <div className="checkout-modal-head-left">
          <span className="checkout-modal-icon"><ReceiptText size={20} /></span>
          <div><span className="cashier-kicker">Review order</span><h2 id="checkout-title">Checkout</h2></div>
        </div>
        <button type="button" onClick={onCancel} aria-label="Close checkout">&times;</button>
      </header>
      <div className="checkout-modal-body">
        <section className="checkout-review-list" aria-label="Order items">
          {cart.map((item) => <article key={item.lineKey}>
            <div><b>{item.name}</b><span>{customizationDetails(item).join(' / ') || 'Standard preparation'}</span></div>
            <span className="checkout-quantity">&times;{item.qty}</span>
            <strong>{peso(itemLineTotal(item))}</strong>
          </article>)}
        </section>
        <section className="checkout-totals"><p><span>Subtotal</span><b>{peso(subtotal)}</b></p><p><strong>Total</strong><strong>{peso(total)}</strong></p></section>
        <section className="checkout-section"><h3>Discount</h3><div className="checkout-choice-grid">{discountChoices.map((choice) => <button type="button" key={choice} className={activeDiscount === choice ? 'active' : ''} onClick={() => chooseDiscount(choice)}>{choice}</button>)}</div>
          {discount.enabled ? <div className="checkout-field-grid"><label>Name<input value={discount.customerName} onChange={(event) => setDiscount((current) => ({ ...current, customerName: event.target.value }))} placeholder="Customer name" /></label><label>ID number<input value={discount.idNumber} onChange={(event) => setDiscount((current) => ({ ...current, idNumber: event.target.value }))} placeholder="PWD or senior ID" /></label></div> : null}
        </section>
        <section className="checkout-section"><h3>Payment</h3><div className="checkout-choice-grid checkout-payment-grid">{paymentChoices.map(({ value, label, icon: Icon }) => <button type="button" key={value} className={payment.method === value ? 'active' : ''} onClick={() => setPayment((current) => ({ ...current, method: value }))}><Icon size={17} />{label}</button>)}</div>
          {payment.method === 'Cash' ? <div className="checkout-field-grid"><label>Amount paid<input type="number" min={total} step="0.01" value={payment.cashReceived} onChange={(event) => setPayment((current) => ({ ...current, cashReceived: event.target.value }))} placeholder={peso(total)} /></label><label>Change<input readOnly value={peso(change)} /></label></div> : null}
          {payment.method === 'GCash' ? <div className="checkout-field-grid checkout-one-field"><label>Reference number<input value={payment.referenceNumber} onChange={(event) => setPayment((current) => ({ ...current, referenceNumber: event.target.value.replace(/\D/g, '').slice(0, 13) }))} placeholder="13-digit reference number" /></label></div> : null}
          {payment.method === 'Bank Transfer' ? <div className="checkout-field-grid"><label>Bank name<input value={payment.bankName} onChange={(event) => setPayment((current) => ({ ...current, bankName: event.target.value }))} placeholder="Bank name" /></label><label>Reference number<input value={payment.referenceNumber} onChange={(event) => setPayment((current) => ({ ...current, referenceNumber: event.target.value.replace(/[^A-Za-z0-9-]/g, '').slice(0, 30) }))} placeholder="Reference number" /></label></div> : null}
        </section>
      </div>
      {error ? <div className="checkout-error">{error}</div> : null}
      <footer className="checkout-actions"><button type="button" onClick={onCancel}>Cancel</button><button type="button" onClick={onConfirm}>Confirm order</button></footer>
    </section>
  </div>
}
function CashierTransactionsModal({ transactions, onViewDetails, onOpenReceipt, onClose }) {
  const [query, setQuery] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('All')
  const [periodFilter, setPeriodFilter] = useState('All time')
  const [discountFilter, setDiscountFilter] = useState('All discounts')
  const [sortOrder, setSortOrder] = useState('recent')
  const [page, setPage] = useState(1)
  const visibleTransactions = transactions.filter((order) => {
    const matchesQuery = `${order.orderNumber} ${order.customerName} ${order.paymentMethod}`.toLowerCase().includes(query.trim().toLowerCase())
    const method = String(order.paymentMethod || '').toLowerCase().replace(/\s+/g, '_')
    const matchesPayment = paymentFilter === 'All' || method === paymentFilter
    const createdAt = new Date(order.createdAt).getTime()
    const orderDate = new Date(createdAt)
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
    const matchesPeriod = periodFilter === 'All time' || Number.isNaN(createdAt) || (periodFilter === 'Today' ? orderDate.toDateString() === new Date().toDateString() : periodFilter === 'Yesterday' ? orderDate.toDateString() === yesterday.toDateString() : Date.now() - createdAt <= 604800000)
    const discountType = String(order.discountType || '').toLowerCase()
    const matchesDiscount = discountFilter === 'All discounts' || (discountFilter === 'No discount' ? !Number(order.discountAmount || 0) : discountType === discountFilter.toLowerCase())
    return matchesQuery && matchesPayment && matchesPeriod && matchesDiscount
  }).sort((first, second) => {
    const firstDate = new Date(first.createdAt).getTime() || 0
    const secondDate = new Date(second.createdAt).getTime() || 0
    return sortOrder === 'recent' ? secondDate - firstDate : firstDate - secondDate
  })
  const pageSize = 8
  const totalPages = Math.max(1, Math.ceil(visibleTransactions.length / pageSize))
  const currentPage = Math.min(page, totalPages)
  const pageStart = (currentPage - 1) * pageSize
  const pageTransactions = visibleTransactions.slice(pageStart, pageStart + pageSize)
  const pageNumbers = Array.from({ length: Math.min(3, totalPages) }, (_, index) => index + 1)
  useEffect(() => { if (page !== currentPage) setPage(currentPage) }, [page, currentPage])
  const label = (method) => ({ cash: 'Cash', gcash: 'GCash', bank_transfer: 'Bank transfer' }[String(method || '').toLowerCase()] || method || 'Cash')
  return <div className="cashier-transactions-backdrop" role="dialog" aria-modal="true" aria-labelledby="transactions-title">
    <section className="cashier-transactions-modal">
      <header><div><span>Cashier records</span><h2 id="transactions-title">Transaction History</h2></div><button type="button" onClick={onClose} aria-label="Close transaction history">&times;</button></header>
      <div className="transaction-toolbar">
        <label className="transaction-search"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search order, customer, or payment" /></label>
        <div className="transaction-filters"><select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} aria-label="Sort transactions"><option value="recent">Most Recent</option><option value="oldest">Oldest</option></select><select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)} aria-label="Payment method"><option value="All">All payments</option><option value="cash">Cash</option><option value="gcash">GCash</option><option value="bank_transfer">Bank transfer</option></select><select value={discountFilter} onChange={(event) => setDiscountFilter(event.target.value)} aria-label="Discount type"><option>All discounts</option><option>No discount</option><option>PWD</option><option>Senior</option></select><select value={periodFilter} onChange={(event) => setPeriodFilter(event.target.value)} aria-label="Time period"><option>All time</option><option>Today</option><option>Yesterday</option><option>Last 7 days</option></select></div>
      </div>
      <div className="transaction-list-heading"><span>Order ID</span><span>Payment</span><span>Amount</span><span>Actions</span></div>
      <div className="cashier-transactions-list">{visibleTransactions.length === 0 ? <div className="cashier-empty-state"><ReceiptText size={28} /><b>No transactions found</b><span>Try another search term or filter.</span></div> : pageTransactions.map((order) => <article key={order.id}><div className="transaction-order"><b>{order.orderNumber}</b><span>{formatReceiptDate(order.createdAt)}</span></div><span className="transaction-payment">{label(order.paymentMethod)}</span><strong>{peso(order.total)}</strong><div className="transaction-actions"><button type="button" onClick={() => onViewDetails(order)}>View Details</button><button type="button" onClick={() => onOpenReceipt(order)}>Receipt</button></div></article>)}</div>
      <footer className="transaction-pagination"><span>Showing {pageTransactions.length} out of {visibleTransactions.length}</span><nav aria-label="Transaction pages"><button type="button" onClick={() => setPage(1)} disabled={currentPage === 1} aria-label="First page">&laquo;</button><button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={currentPage === 1} aria-label="Previous page">&lsaquo;</button>{pageNumbers.map((pageNumber) => <button type="button" className={currentPage === pageNumber ? 'active' : ''} key={pageNumber} onClick={() => setPage(pageNumber)}>{pageNumber}</button>)}{totalPages > 4 ? <span className="transaction-page-gap">&hellip;</span> : null}{totalPages > 3 ? <button type="button" className={currentPage === totalPages ? 'active' : ''} onClick={() => setPage(totalPages)}>{totalPages}</button> : null}<button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={currentPage === totalPages} aria-label="Next page">&rsaquo;</button><button type="button" onClick={() => setPage(totalPages)} disabled={currentPage === totalPages} aria-label="Last page">&raquo;</button></nav></footer>
    </section>
  </div>
}

function TransactionDetailsModal({ order, onBack, onClose }) {
  const items = order.items || []
  const hasDiscount = Number(order.discountAmount || 0) > 0
  const paymentDetails = [
    ...(order.paymentReference ? [['Reference number', order.paymentReference]] : []),
    ...(order.bankName ? [['Bank name', order.bankName]] : []),
    ...(order.paymentMethod === 'Cash' || Number(order.cashReceived || 0) ? [['Amount paid', peso(order.cashReceived || order.total)], ['Change', peso(order.change || 0)]] : []),
  ]
  return <div className="transaction-details-backdrop" role="dialog" aria-modal="true" aria-labelledby="details-title">
    <section className="transaction-details-modal">
      <header><div><span>Transaction record</span><h2 id="details-title">Order Details</h2></div><div className="transaction-details-head-actions"><button type="button" onClick={onBack}>Back to transaction history</button><button type="button" onClick={onClose} aria-label="Close order details">&times;</button></div></header>
      <div className="transaction-details-body">
        <div className="detail-meta"><div><span>Order ID</span><b>{order.orderNumber}</b></div><div><span>Date</span><b>{formatReceiptDate(order.createdAt)}</b></div><div><span>Payment</span><b>{order.paymentMethod}</b></div></div>
        <section><h3>Items</h3><div className="detail-items">{items.length ? items.map((item, index) => <article key={item.lineKey || item.id || index}><div><b>{item.name || item.product_name || item.item_name || 'Menu item'}</b><span>{customizationDetails(item).join(' / ') || 'Standard preparation'}</span></div><span>&times;{item.qty || item.quantity || 0}</span><strong>{peso(item.line_total || itemLineTotal(item))}</strong></article>) : <p>No item details are available for this transaction.</p>}</div></section>
        <section className="detail-summary"><h3>Payment details</h3>{paymentDetails.length ? <div>{paymentDetails.map(([label, value]) => <p key={label}><span>{label}</span><b>{value}</b></p>)}</div> : <p>Payment details are not available for this transaction.</p>}</section>
        <section className="detail-summary"><h3>Order summary</h3><div><p><span>Subtotal</span><b>{peso(order.subtotal)}</b></p>{hasDiscount ? <><p><span>{order.discountType || 'Discount'}</span><b>-{peso(order.discountAmount)}</b></p>{order.discountCustomerName ? <p><span>Discount name</span><b>{order.discountCustomerName}</b></p> : null}{order.discountIdNumber ? <p><span>Discount ID</span><b>{order.discountIdNumber}</b></p> : null}</> : <p><span>Discount</span><b>No discount</b></p>}</div></section>
        <div className="detail-total"><span>Total</span><strong>{peso(order.total)}</strong></div>
      </div>
    </section>
  </div>
}
function formatReceiptDate(value) {
  if (!value) return 'N/A'
  return new Date(value).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' })
}

function receiptPaymentRows(order) {
  if (order.paymentMethod === 'GCash') {
    return [
      ['Payment Reference Number', order.paymentReference],
      ['Account Number', order.accountNumber],
    ].filter((row) => row[1])
  }
  if (order.paymentMethod === 'Bank Transfer') {
    return [
      ['Bank Name', order.bankName],
      ['Payment Reference Number', order.paymentReference],
    ].filter((row) => row[1])
  }
  return [
    ['Cash Received', peso(order.cashReceived)],
    ['Change', peso(order.change)],
  ]
}

function CashierReceipt({ order, onClose }) {
  const itemCount = (order.items || []).reduce((sum, item) => sum + Number(item.qty || item.quantity || 0), 0)
  const cashierName = order.cashierName || 'Cashier'
  return <div className="cashier-receipt-backdrop">
    <section className="cashier-receipt-modal" role="dialog" aria-modal="true" aria-label="Receipt preview">
      <header className="cashier-receipt-modal-head">
        <h3>Receipt Preview</h3>
      </header>
      <div className="receipt-preview-shell">
        <div className="receipt-print-area">
          <div className="receipt-header">
            <img className="receipt-logo" src="/images/coffeerealmlogo.png" alt="Store logo" />
            <div className="receipt-store-name">{store.name}</div>
            <div className="receipt-store-info">{store.address}</div>
            <div className="receipt-store-info">{store.phone}</div>
          </div>
          <div className="receipt-line" />
          <div className="receipt-row"><span className="receipt-label">Order #:</span><span className="receipt-value">{order.orderNumber}</span></div>
          <div className="receipt-row"><span className="receipt-label">Reference #:</span><span className="receipt-value">{order.orderNumber}</span></div>
          <div className="receipt-row"><span className="receipt-label">Date:</span><span className="receipt-value">{formatReceiptDate(order.createdAt)}</span></div>
          <div className="receipt-row"><span className="receipt-label">Type:</span><span className="receipt-value">Walk-in</span></div>
          <div className="receipt-row"><span className="receipt-label">Cashier:</span><span className="receipt-value">{cashierName}</span></div>
          <div className="receipt-line" />
          <div className="receipt-table-header"><div>QTY</div><div>ITEM</div><div>PRICE</div></div>
          <div className="receipt-line" />
          <div className="receipt-items">
            {(order.items || []).map((item) => {
              const qty = Number(item.qty || item.quantity || 0)
              const name = item.name || item.product_name || 'Menu item'
              const receiptLineTotal = Number(item.line_total || itemLineTotal(item) || item.unit_price * item.quantity || 0)
              return <div className="receipt-item" key={item.lineKey || item.id || name}>
                <div>{qty}</div>
                <div className="receipt-item-name">{name}{customizationDetails(item).map((detail) => <div className="receipt-option" key={detail}>+ {detail}</div>)}{Number(item.is_discounted || item.isDiscounted || 0) ? <div className="receipt-option">+ {order.discountType || 'Discount'} discount applied</div> : null}</div>
                <div className="receipt-item-price">{Number(receiptLineTotal || 0).toFixed(2)}</div>
              </div>
            })}
          </div>
          <div className="receipt-line" />
          <div className="receipt-total-row"><span>Subtotal:</span><span>{Number(order.subtotal || 0).toFixed(2)}</span></div>
          {Number(order.discountAmount || 0) > 0 ? <div className="receipt-total-row"><span>{order.discountType || 'Discount'}:</span><span>-{Number(order.discountAmount || 0).toFixed(2)}</span></div> : null}
          <div className="receipt-total-row"><span>TOTAL:</span><span className="receipt-grand-total">{Number(order.total || 0).toFixed(2)}</span></div>
          <div className="receipt-line" />
          <div className="receipt-row"><span className="receipt-label">Payment Method:</span><span className="receipt-value">{order.paymentMethod}</span></div>
          {Number(order.discountAmount || 0) > 0 ? <div className="receipt-row"><span className="receipt-label">Discount ID:</span><span className="receipt-value">{order.discountIdNumber || 'N/A'}</span></div> : null}
          {receiptPaymentRows(order).map(([label, value]) => <div className="receipt-row" key={label}><span className="receipt-label">{label}:</span><span className="receipt-value">{value}</span></div>)}
          <div className="receipt-line" />
          <div className="receipt-row"><span className="receipt-label">Items:</span><span className="receipt-value">{itemCount}</span></div>
          <div className="receipt-line" />
          <div className="receipt-footer">Thank you for choosing thecoffeerealm,<br />Enjoy your drink and have a great day!</div>
          <div className="receipt-line" />
        </div>
      </div>
      <footer className="cashier-receipt-actions">
        <button type="button" onClick={() => window.print()}>Print</button>
        <button type="button" onClick={onClose}>Close</button>
      </footer>
    </section>
  </div>
}
