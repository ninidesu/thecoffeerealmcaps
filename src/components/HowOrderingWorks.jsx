import { motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, CakeSlice, Coffee, UtensilsCrossed } from 'lucide-react'
import { Link } from 'react-router-dom'

const steps = [
  {
    number: '01',
    title: 'Choose a hearty meal',
    copy: 'Start with one of our filling comfort-food favorites.',
    label: 'Katsu Curry, Beef Tapa, and Corned Beef & Spam',
    icon: UtensilsCrossed,
    items: [
      { name: 'Beef Tapa', image: '/images/ordering/beef-tapa-cutout.webp', x: '25%', y: '57%', size: '52%', rotate: '-7deg', z: 1, delay: '-1.7s' },
      { name: 'Corned Beef & Spam', image: '/images/ordering/corned-beef-spam-cutout.webp', x: '76%', y: '57%', size: '52%', rotate: '7deg', z: 1, delay: '-3.4s' },
      { name: 'Katsu Curry', image: '/images/ordering/katsu-curry-cutout.webp', x: '50%', y: '39%', size: '62%', rotate: '-1deg', z: 2, delay: '0s' },
    ],
  },
  {
    number: '02',
    title: 'Add snacks and drinks',
    copy: 'Round it out with something crunchy and a handcrafted drink.',
    label: 'Classic Nachos, Nuggets & Fries, Biscoff Latte, and Matcha Latte',
    icon: Coffee,
    items: [
      { name: 'Biscoff Latte', image: '/images/ordering/biscoff-latte-cutout.webp', x: '20%', y: '43%', size: '31%', rotate: '-6deg', z: 1, delay: '-2.8s' },
      { name: 'Matcha Latte', image: '/images/ordering/matcha-latte-cutout.webp', x: '80%', y: '43%', size: '31%', rotate: '6deg', z: 1, delay: '-1.1s' },
      { name: 'Classic Nachos', image: '/images/ordering/classic-nachos-cutout.webp', x: '36%', y: '65%', size: '49%', rotate: '-6deg', z: 2, delay: '-4.2s' },
      { name: 'Nuggets & Fries', image: '/images/ordering/nuggets-fries-cutout.webp', x: '66%', y: '65%', size: '49%', rotate: '5deg', z: 3, delay: '-2s' },
    ],
  },
  {
    number: '03',
    title: 'Finish with something sweet',
    copy: 'Complete your order with cake, tiramisu, or a box of bestselling cookies.',
    label: 'Red Velvet Cake, Tiramisu, and Cookies Bestseller Box',
    icon: CakeSlice,
    items: [
      { name: 'Cookies Bestseller Box', image: '/images/ordering/bestseller-cookies-cutout.webp', x: '50%', y: '29%', size: '58%', rotate: '0deg', z: 1, delay: '-3.6s' },
      { name: 'Red Velvet Cake', image: '/images/ordering/red-velvet-cake-cutout.webp', x: '29%', y: '61%', size: '54%', rotate: '-7deg', z: 2, delay: '-1.4s' },
      { name: 'Tiramisu', image: '/images/ordering/tiramisu-cutout.webp', x: '70%', y: '61%', size: '52%', rotate: '7deg', z: 3, delay: '-4.8s' },
    ],
  },
]

export default function HowOrderingWorks() {
  const reduceMotion = useReducedMotion()
  const itemVariants = {
    hidden: { opacity: 0, y: reduceMotion ? 0 : 28 },
    show: { opacity: 1, y: 0, transition: { duration: reduceMotion ? 0.01 : 0.55, ease: [0.22, 1, 0.36, 1] } },
  }

  return (
    <section className="ordering-works" aria-labelledby="ordering-works-title">
      <motion.header
        className="ordering-works-heading"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.35 }}
        variants={itemVariants}
      >
        <span className="eyebrow">Build your perfect café order</span>
        <h2 id="ordering-works-title">How ordering works.</h2>
        <p>Start savory, add your favorite sips and sides, then save room for something sweet.</p>
      </motion.header>

      <motion.div
        className="ordering-steps"
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, amount: 0.18 }}
        variants={{ hidden: {}, show: { transition: { staggerChildren: reduceMotion ? 0 : 0.12 } } }}
      >
        {steps.map((step) => {
          const Icon = step.icon
          return (
            <motion.article className="ordering-step" variants={itemVariants} key={step.number}>
              <div className="ordering-cluster" role="img" aria-label={step.label}>
                {step.items.map((item) => (
                  <img
                    className="ordering-cluster-item"
                    src={item.image}
                    alt=""
                    loading="lazy"
                    key={item.name}
                    style={{
                      '--item-x': item.x,
                      '--item-y': item.y,
                      '--item-size': item.size,
                      '--item-rotate': item.rotate,
                      '--item-z': item.z,
                      '--item-delay': item.delay,
                    }}
                  />
                ))}
              </div>
              <div className="ordering-step-copy">
                <Icon size={22} aria-hidden="true" />
                <h3>{step.title}</h3>
                <p>{step.copy}</p>
              </div>
            </motion.article>
          )
        })}
      </motion.div>

      <motion.div className="ordering-works-action" initial="hidden" whileInView="show" viewport={{ once: true }} variants={itemVariants}>
        <Link className="button button-dark" to="/menu">Start your order <ArrowRight size={17} /></Link>
      </motion.div>
    </section>
  )
}