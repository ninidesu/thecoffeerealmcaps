import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import CoffeeCard from './CoffeeCard'

const AUTO_SLIDE_MS = 4500
const SWIPE_THRESHOLD = 50
const WHEEL_COOLDOWN_MS = 400

export default function BestSellerCarousel({ items, onAddToCart }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [isHovering, setIsHovering] = useState(false)
  const wheelLockRef = useRef(false)
  const trackRef = useRef(null)

  const goTo = useCallback(
    (index) => {
      const next = ((index % items.length) + items.length) % items.length
      setActiveIndex(next)
    },
    [items.length],
  )

  const goNext = useCallback(() => goTo(activeIndex + 1), [activeIndex, goTo])
  const goPrev = useCallback(() => goTo(activeIndex - 1), [activeIndex, goTo])

  useEffect(() => {
    if (isHovering || items.length < 2) return undefined
    const timer = setInterval(() => {
      setActiveIndex((current) => (current + 1) % items.length)
    }, AUTO_SLIDE_MS)
    return () => clearInterval(timer)
  }, [isHovering, items.length])

  const handleWheel = (event) => {
    if (Math.abs(event.deltaX) < Math.abs(event.deltaY)) return
    event.preventDefault()
    if (wheelLockRef.current) return
    wheelLockRef.current = true
    if (event.deltaX > 10) goNext()
    else if (event.deltaX < -10) goPrev()
    setTimeout(() => {
      wheelLockRef.current = false
    }, WHEEL_COOLDOWN_MS)
  }

  const handleDragEnd = (_event, info) => {
    if (info.offset.x < -SWIPE_THRESHOLD) goNext()
    else if (info.offset.x > SWIPE_THRESHOLD) goPrev()
  }

  const handleKeyDown = (event) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault()
      goNext()
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault()
      goPrev()
    }
  }

  return (
    <div
      className="coffee-carousel"
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onWheel={handleWheel}
      onKeyDown={handleKeyDown}
      role="region"
      aria-roledescription="carousel"
      aria-label="Best seller coffee and treats"
      tabIndex={0}
    >
      <button
        type="button"
        className="coffee-carousel-nav coffee-carousel-nav-prev"
        onClick={goPrev}
        aria-label="Show previous coffee"
      >
        <ChevronLeft size={22} />
      </button>

      <motion.div
        ref={trackRef}
        className="coffee-carousel-track"
        drag="x"
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.15}
        onDragEnd={handleDragEnd}
      >
        {items.map((item, index) => {
          let offset = index - activeIndex
          if (offset > items.length / 2) offset -= items.length
          if (offset < -items.length / 2) offset += items.length

          return (
            <CoffeeCard
              key={item.id}
              item={item}
              offset={offset}
              isActive={offset === 0}
              onSelect={(cardOffset) => goTo(activeIndex + cardOffset)}
              onAddToCart={onAddToCart}
            />
          )
        })}
      </motion.div>

      <button
        type="button"
        className="coffee-carousel-nav coffee-carousel-nav-next"
        onClick={goNext}
        aria-label="Show next coffee"
      >
        <ChevronRight size={22} />
      </button>

      <div className="coffee-carousel-dots" role="tablist" aria-label="Select coffee">
        {items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={index === activeIndex}
            aria-label={`Show ${item.name}`}
            className={index === activeIndex ? 'active' : ''}
            onClick={() => goTo(index)}
          />
        ))}
      </div>
    </div>
  )
}
