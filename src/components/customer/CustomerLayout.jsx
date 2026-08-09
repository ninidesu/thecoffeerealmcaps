import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { LogIn, LogOut, Menu, Minus, Plus, ShoppingBag, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import Brand from '../Brand'
import { useAuth } from '../../context/AuthContext'
import { useCart } from '../../context/CartContext'
import { isCustomerRole } from '../../lib/auth'
import LogoutConfirmModal from '../auth/LogoutConfirmModal'

const centerLinks = [['Menu', '/menu'], ['My Orders', '/orders'], ['Help', '/help'], ['Settings', '/settings']]
const money = (value) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(value)

export default function CustomerLayout() {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [logoutOpen, setLogoutOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const { user, profile, signOut } = useAuth()
  const customerUser = user && isCustomerRole(profile?.role) ? user : null
  const cart = useCart()
  const navigate = useNavigate()
  const location = useLocation()
  const close = () => setOpen(false)

  useEffect(() => {
    if (!cart.drawerOpen) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const escape = (event) => {
      if (event.key === 'Escape') cart.closeCart()
    }
    document.addEventListener('keydown', escape)
    return () => {
      document.body.style.overflow = previous
      document.removeEventListener('keydown', escape)
    }
  }, [cart])

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  async function logout() {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await signOut()
      close()
      navigate('/')
    } finally {
      setLoggingOut(false)
      setLogoutOpen(false)
    }
  }

  return (
    <div className="customer-app">
      <header className={`customer-header${scrolled ? ' is-scrolled' : ''}`}>
        <div className="customer-brand"><Brand /></div>
        <button
          className="mobile-menu"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="customer-navigation"
          aria-label="Toggle navigation"
        >
          {open ? <X /> : <Menu />}
        </button>
        <nav id="customer-navigation" className={open ? 'open' : ''}>
          <div className="customer-nav-center">
            {centerLinks.map(([label, to]) => <NavLink key={to} to={to} onClick={close}>{label}</NavLink>)}
          </div>
          <div className="customer-nav-actions">
            <button className="nav-cart" type="button" onClick={() => { close(); cart.openCart() }} aria-haspopup="dialog">
              <ShoppingBag size={18} />
              <span>Cart</span>
              <b aria-label={`${cart.itemCount} cart items`}>{cart.itemCount}</b>
            </button>
            {customerUser ? (
              <button className="nav-auth-action" type="button" onClick={() => setLogoutOpen(true)}>
                <LogOut size={18} />
                Logout
              </button>
            ) : (
              <NavLink className="nav-auth-action" to="/login" onClick={close}>
                <LogIn size={18} />
                Log in
              </NavLink>
            )}
          </div>
        </nav>
      </header>
      <div className="customer-route-shell" key={location.pathname}><Outlet /></div>
      <CartDrawer cart={cart} user={customerUser} />
      {location.pathname !== '/' && (
        <footer className="customer-footer">
          <Brand light />
          <p>Fresh coffee, homemade comfort, and slow little moments in North Fairview.</p>
          <div><Link to="/menu">Menu</Link><Link to="/about">About</Link><Link to="/contact">Contact</Link></div>
          <small>© 2026 thecoffeerealm.</small>
        </footer>
      )}
      <LogoutConfirmModal
        open={logoutOpen}
        busy={loggingOut}
        onCancel={() => setLogoutOpen(false)}
        onConfirm={logout}
      />
    </div>
  )
}

function CartDrawer({ cart, user }) {
  const [confirmClear, setConfirmClear] = useState(false)
  const clear = () => { cart.clearCart(); setConfirmClear(false) }

  return (
    <>
      <button
        className={`cart-drawer-backdrop ${cart.drawerOpen ? 'visible' : ''}`}
        onClick={cart.closeCart}
        aria-label="Close cart"
        tabIndex={cart.drawerOpen ? 0 : -1}
      />
      <aside
        className={`cart-drawer ${cart.drawerOpen ? 'open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-hidden={!cart.drawerOpen}
        aria-labelledby="cart-drawer-title"
      >
        <header>
          <div><span>Your order</span><h2 id="cart-drawer-title">Cart <b>{cart.itemCount}</b></h2></div>
          <button type="button" onClick={cart.closeCart} aria-label="Close cart"><X /></button>
        </header>
        <div className="cart-drawer-body">
          {cart.items.length === 0 ? (
            <div className="drawer-empty">
              <ShoppingBag />
              <h3>Your cart is empty</h3>
              <p>Add something you love from today's menu.</p>
              <Link className="primary-button" to="/menu" onClick={cart.closeCart}>Browse menu</Link>
            </div>
          ) : cart.items.map((item) => (
            <article className="drawer-cart-item" key={item.lineId}>
              <img src={item.image} alt="" />
              <div>
                <h3>{item.name}</h3>
                <p>{[item.variation?.name, item.temperature, item.ice, item.sugar].filter(Boolean).join(' · ')}</p>
                {item.addons?.length > 0 && <small>{item.addons.map((addon) => addon.name).join(', ')}</small>}
                <strong>{money((item.unitPrice + (item.addons || []).reduce((sum, addon) => sum + addon.price, 0)) * item.quantity)}</strong>
                <div className="drawer-item-actions">
                  <button onClick={() => cart.updateQuantity(item.lineId, item.quantity - 1)} aria-label={`Decrease ${item.name}`}><Minus /></button>
                  <b>{item.quantity}</b>
                  <button onClick={() => cart.updateQuantity(item.lineId, item.quantity + 1)} aria-label={`Increase ${item.name}`}><Plus /></button>
                  <button className="remove-line" onClick={() => cart.removeItem(item.lineId)} aria-label={`Remove ${item.name}`}><Trash2 /></button>
                </div>
              </div>
            </article>
          ))}
        </div>
        {cart.items.length > 0 && (
          <footer>
            <div><span>Subtotal</span><b>{money(cart.subtotal)}</b></div>
            <p>Delivery fees and discounts are calculated during checkout.</p>
            <Link className="primary-button" to={user ? '/checkout' : '/login'} state={user ? undefined : { from: '/checkout' }} onClick={cart.closeCart}>Proceed to checkout</Link>
            <button className="drawer-clear" type="button" onClick={() => setConfirmClear(true)}><Trash2 />Clear cart</button>
          </footer>
        )}
      </aside>
      {confirmClear && (
        <div className="clear-cart-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmClear(false) }}>
          <section className="clear-cart-modal" role="alertdialog" aria-modal="true" aria-labelledby="clear-cart-title" aria-describedby="clear-cart-copy">
            <span><Trash2 /></span>
            <h2 id="clear-cart-title">Clear your cart?</h2>
            <p id="clear-cart-copy">This will remove all {cart.itemCount} item{cart.itemCount === 1 ? '' : 's'} from your cart.</p>
            <div>
              <button className="secondary-button" type="button" onClick={() => setConfirmClear(false)}>Keep items</button>
              <button className="danger-button" type="button" onClick={clear}>Clear cart</button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
