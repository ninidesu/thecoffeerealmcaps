import { motion } from 'framer-motion'
import { Plus } from 'lucide-react'

export default function CoffeeCard({ item, offset, isActive, onSelect, onAddToCart }) {
  const distance = Math.abs(offset)
  const cardScale = isActive ? 1.06 : distance === 1 ? 0.9 : 0.82
  const cardOpacity = isActive ? 1 : distance === 1 ? 0.62 : distance === 2 ? 0.28 : 0

  return (
    <motion.article
      className={`coffee-card${isActive ? ' coffee-card-active' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${item.name}${isActive ? ', selected' : ', show this coffee'}`}
      aria-current={isActive}
      onClick={() => onSelect(offset)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect(offset)
        }
      }}
      animate={{
        x: `${offset * 78}%`,
        scale: cardScale,
        opacity: cardOpacity,
        zIndex: 10 - distance,
        y: isActive ? -10 : 0,
      }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: (isActive ? -10 : 0) - 6, scale: cardScale * 1.02 }}
      whileTap={{ scale: cardScale * 0.98 }}
    >
      <div className="coffee-card-image">
        <img src={item.image} alt={item.name} draggable={false} />
        <span>{item.category}</span>
      </div>
      <div className="coffee-card-body">
        <h3>{item.name}</h3>
        {item.description && <p>{item.description}</p>}
        <div className="coffee-card-footer">
          <b>PHP {Number(item.price).toFixed(2)}</b>
          <button
            type="button"
            className="coffee-card-add"
            aria-label={`Add ${item.name} to cart`}
            onClick={(event) => {
              event.stopPropagation()
              onAddToCart(item)
            }}
          >
            <Plus size={16} /> Add to Cart
          </button>
        </div>
      </div>
    </motion.article>
  )
}
