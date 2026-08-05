import { motion } from 'framer-motion'
import { Plus } from 'lucide-react'

export default function CoffeeCard({ item, offset, isActive, revealed, onSelect, onAddToCart }) {
  const distance = Math.abs(offset)
  const cardScale = isActive ? 1.06 : distance === 1 ? 0.9 : 0.82
  const cardOpacity = isActive ? 1 : distance === 1 ? 0.62 : distance === 2 ? 0.28 : 0
  const revealDelay = isActive ? 0.06 : distance === 1 ? 0.12 : 0.16
  const hiddenY = isActive ? 18 : 10
  const hiddenX = offset === 0 ? 0 : offset > 0 ? 56 : -56
  const hiddenRotate = offset === 0 ? 0 : offset > 0 ? 4 : -4

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
      initial={revealed ? false : {
        opacity: 0,
        x: hiddenX,
        y: hiddenY,
        rotate: hiddenRotate,
        scale: cardScale * 0.96,
        filter: 'blur(8px)',
      }}
      animate={{
        x: `${offset * 78}%`,
        scale: cardScale,
        opacity: cardOpacity,
        zIndex: 10 - distance,
        y: isActive ? -10 : 0,
        rotate: 0,
        filter: 'blur(0px)',
      }}
      transition={{
        duration: 0.44,
        delay: revealed ? 0 : revealDelay,
        ease: [0.22, 1, 0.36, 1],
      }}
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
