import { Minus, Plus, Search, ShoppingBag, SlidersHorizontal, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import Brand from '../components/Brand'
import { menuItems } from '../data/mockData'

export default function MenuPage() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [cart, setCart] = useState([])
  const categories = ['All', ...new Set(menuItems.map(item => item.category))]
  const filtered = useMemo(() => menuItems.filter(i => (category === 'All' || i.category === category) && i.name.toLowerCase().includes(query.toLowerCase())), [query, category])
  const add = item => setCart(current => {
    const found = current.find(i => i.id === item.id)
    return found ? current.map(i => i.id === item.id ? { ...i, qty: i.qty + 1 } : i) : [...current, { ...item, qty: 1 }]
  })
  const change = (id, delta) => setCart(current => current.map(i => i.id === id ? { ...i, qty: i.qty + delta } : i).filter(i => i.qty > 0))
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0)
  return (
    <div className="menu-page">
      <header className="menu-header"><Brand /><nav><a href="/">Home</a><a className="active" href="/menu">Menu</a><a href="/orders">My orders</a></nav><button className="cart-trigger"><ShoppingBag size={19} /> Cart <span>{cart.reduce((s, i) => s + i.qty, 0)}</span></button></header>
      <div className="menu-intro"><span className="eyebrow">Order online</span><h1>What are you craving?</h1><p>Made fresh from our Fairview branch. Choose pickup or delivery at checkout.</p></div>
      <div className="menu-content">
        <div className="catalog">
          <div className="filter-row"><label className="search"><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search the menu" /></label><div className="categories">{categories.map(c => <button className={category === c ? 'active' : ''} onClick={() => setCategory(c)} key={c}>{c}</button>)}</div><button className="icon-button" aria-label="More filters"><SlidersHorizontal size={19} /></button></div>
          <div className="menu-grid">{filtered.map(item => <article className="menu-card" key={item.id}><img src={item.image} alt={item.name} /><div><small>{item.category}</small><h3>{item.name}</h3><p>{item.description || `Original ${item.category} item from The Coffee Realm catalog.`}</p><footer><b>₱{item.price}</b><button onClick={() => add(item)}><Plus size={18} /> Add</button></footer></div></article>)}</div>
        </div>
        <aside className="cart-panel"><div className="cart-title"><div><span>Your order</span><small>Pickup · Fairview</small></div><ShoppingBag size={22} /></div>{cart.length === 0 ? <div className="empty-cart"><ShoppingBag size={32} /><b>Your bag is empty</b><span>Add a favorite to get started.</span></div> : <><div className="cart-items">{cart.map(item => <div className="cart-item" key={item.id}><img src={item.image} alt="" /><div><b>{item.name}</b><span>₱{item.price}</span><div className="quantity"><button onClick={() => change(item.id,-1)}><Minus size={14}/></button><span>{item.qty}</span><button onClick={() => change(item.id,1)}><Plus size={14}/></button></div></div><button className="remove" onClick={() => setCart(c => c.filter(i => i.id !== item.id))} aria-label={`Remove ${item.name}`}><X size={15}/></button></div>)}</div><div className="cart-total"><span>Subtotal</span><b>₱{total}</b></div><button className="button button-dark checkout">Continue to checkout</button></>}</aside>
      </div>
    </div>
  )
}

