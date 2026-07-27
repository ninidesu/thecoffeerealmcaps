/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
const CartContext = createContext(null)
const key = 'coffee-realm-guest-cart-v1'
const signature = item => [item.productId,item.variation?.id || '',...(item.addons || []).map(a=>a.id).sort()].join('|')
export function CartProvider({ children }) {
 const [items,setItems]=useState(()=>{try{return JSON.parse(localStorage.getItem(key))||[]}catch{return[]}})
 useEffect(()=>localStorage.setItem(key,JSON.stringify(items)),[items])
 const addItem=(next)=>setItems(current=>{const sig=signature(next);const found=current.find(i=>signature(i)===sig);return found?current.map(i=>signature(i)===sig?{...i,quantity:i.quantity+next.quantity}:i):[...current,{...next,lineId:crypto.randomUUID()}]})
 const updateQuantity=(lineId,quantity)=>setItems(current=>current.map(i=>i.lineId===lineId?{...i,quantity}:i).filter(i=>i.quantity>0))
 const removeItem=lineId=>setItems(current=>current.filter(i=>i.lineId!==lineId))
 const clearCart=()=>setItems([])
 const itemCount=items.reduce((n,i)=>n+i.quantity,0)
 const subtotal=items.reduce((n,i)=>n+((i.unitPrice+(i.addons||[]).reduce((s,a)=>s+a.price,0))*i.quantity),0)
 const value=useMemo(()=>({items,addItem,updateQuantity,removeItem,clearCart,itemCount,subtotal}),[items,itemCount,subtotal])
 return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}
export const useCart=()=>useContext(CartContext)

