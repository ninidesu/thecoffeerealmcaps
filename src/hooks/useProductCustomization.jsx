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

export function useProductCustomization({ alwaysCustomize = false, modalVariant = '' } = {}) {
  const { addItem } = useCart()
  const [product, setProduct] = useState(null)

  const openProduct = (item) => {
    setProduct(item)
  }

  const addToCart = (item) => {
    if (alwaysCustomize || needsCustomization(item)) {
      openProduct(item)
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
      variant={modalVariant}
      onClose={() => setProduct(null)}
      onAdd={(payload) => {
        addItem(payload)
        setProduct(null)
      }}
    />
  ) : null

  return { addToCart, openProduct, modal }
}
