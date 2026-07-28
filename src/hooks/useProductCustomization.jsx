import { useState } from 'react'
import { useCart } from '../context/CartContext'
import ProductCustomizationModal from '../components/ProductCustomizationModal'

export function needsCustomization(product) {
  return Boolean(
    (product.allowAddons && (product.addons || []).length) ||
    (product.variations || []).length ||
    (product.temperatures || []).length ||
    product.allowIce ||
    product.allowSugar,
  )
}

export function useProductCustomization() {
  const { addItem } = useCart()
  const [product, setProduct] = useState(null)

  const addToCart = (item) => {
    if (needsCustomization(item)) {
      setProduct(item)
      return
    }
    addItem({
      productId: item.id,
      slug: item.slug || item.id,
      name: item.name,
      image: item.image,
      variation: null,
      temperature: '',
      ice: '',
      sugar: '',
      addons: [],
      instructions: '',
      quantity: 1,
      unitPrice: item.basePrice ?? item.price,
    })
  }

  const modal = product ? (
    <ProductCustomizationModal
      product={product}
      onClose={() => setProduct(null)}
      onAdd={(payload) => {
        addItem(payload)
        setProduct(null)
      }}
    />
  ) : null

  return { addToCart, modal }
}
