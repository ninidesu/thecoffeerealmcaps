import { ArrowRight, Clock, Facebook, Instagram, Mail, MapPin, MessageCircle, Phone, Star } from 'lucide-react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import Brand from '../components/Brand'
import BestSellerCarousel from '../components/BestSellerCarousel'
import Reveal from '../components/Reveal'
import HowOrderingWorks from '../components/HowOrderingWorks'
import { store } from '../data/mockData'
import { bestSellerItems } from '../data/bestSellers'
import { useProductCustomization } from '../hooks/useProductCustomization'

const reviews = [
  { name: 'Mika S.', quote: 'Their coffee and cheesecakes feel homemade in the best way. Cozy place, kind staff, and always worth coming back to.' },
  { name: 'Ari R.', quote: 'The cookie boxes are my go-to gift. Every flavor tastes fresh and the packaging feels thoughtful.' },
  { name: 'Nico C.', quote: 'Perfect North Fairview coffee stop. Good drinks, comforting meals, and a calm spot to work or meet friends.' },
]

const mapEmbed = 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3859.0124735474096!2d121.05181751066577!3d14.711886674283116!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3397b1c4be33d913%3A0x2ab4591abe2ac00a!2sThe%20Coffee%20Realm%20-%20North%20Fairview!5e0!3m2!1sen!2sph!4v1764156842113!5m2!1sen!2sph'

const fadeUp = { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } } }

export default function HomePage() {
  const { addToCart, modal } = useProductCustomization({
    alwaysCustomize: true,
    modalVariant: 'menu-detail',
  })

  return (
    <div className="storefront customer-landing">
<main>
        <section className="hero landing-hero" id="home">
          <motion.div
            className="hero-copy"
            initial="hidden"
            animate="show"
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.12 } } }}
          >
            <motion.span className="eyebrow" variants={fadeUp}>thecoffeerealm in North Fairview</motion.span>
            <motion.h1 variants={fadeUp}>Fresh coffee, homemade sweets, and slow little moments.</motion.h1>
            <motion.p variants={fadeUp}>We serve comforting coffee-based drinks, freshly baked cookies, homemade cakes, pasta, rice meals, toasts, and snacks in a warm neighborhood space.</motion.p>
            <motion.div className="hero-actions" variants={fadeUp}>
              <Link className="button button-light" to="/menu">View full menu</Link>
              <a className="text-link" href="#preorder">Send a pre-order inquiry <ArrowRight size={17} /></a>
            </motion.div>
            <motion.div className="hero-proof" variants={fadeUp}>
              <div className="avatar-stack"><span>TC</span><span>CR</span><span>QC</span></div>
              <span><b>Customer favorites</b> include tiramisu, burnt cheesecake, and cookie boxes.</span>
            </motion.div>
          </motion.div>
        </section>

        <section className="marquee" aria-label="thecoffeerealm highlights">
          <span>Homemade cakes</span><i>*</i><span>Fresh cookie boxes</span><i>*</i><span>Coffee-based drinks</span><i>*</i><span>North Fairview cafe</span>
        </section>

        <section className="section landing-menu-preview" id="menu">
          <Reveal tag="div" className="section-heading">
            <div><span className="eyebrow">Customer favorites</span><h2>Bestsellers from the realm.</h2></div>
            <Link className="text-link dark" to="/menu">See full menu <ArrowRight size={17} /></Link>
          </Reveal>
          <Reveal tag="div" delay={0.1}>
            <BestSellerCarousel items={bestSellerItems} onAddToCart={addToCart} />
          </Reveal>
        </section>

        <section className="landing-preorder" id="preorder">
          <Reveal tag="div" className="preorder-visual" y={0}>
            <img src="/images/menu/BurntBasqueCheesecake.jpg" alt="thecoffeerealm cake for pre-order" className="floaty-image" />
          </Reveal>
          <Reveal tag="div" className="preorder-copy" delay={0.1}>
            <span className="eyebrow">Pre-order and inquiries</span>
            <h2>Planning a whole cake, cookie box, or coffee run?</h2>
            <p>Send us your inquiry and we will help with availability, serving size, pickup schedule, and order details. Whole cakes are available for pre-order and intimate celebrations.</p>
            <form className="preorder-form" onSubmit={(event) => event.preventDefault()}>
              <div><input type="email" placeholder="Email address" aria-label="Email address" /><input type="tel" placeholder="Contact number" aria-label="Contact number" /></div>
              <input type="text" placeholder="Subject" aria-label="Subject" />
              <textarea placeholder="Message" aria-label="Message" />
              <button type="submit" className="button button-dark">Send Inquiry</button>
            </form>
          </Reveal>
        </section>

        <section className="story landing-about" id="about">
          <Reveal tag="div" className="story-copy">
            <span className="eyebrow">About us</span>
            <h2>A cozy place for coffee, cakes, and conversations.</h2>
            <p>We serve freshly baked cookies, homemade cakes, and comforting coffee-based drinks in a space made for slow days, warm conversations, or solo work dates.</p>
            <p>We also offer pasta, rice meals, toasts, and snacks. Some bestsellers include homemade tiramisu, biscoff burnt cheesecake, and fresh cookie boxes for gifting or sharing.</p>
          </Reveal>
        </section>

        <HowOrderingWorks />

        <section className="section landing-reviews" id="reviews">
          <Reveal tag="div" className="section-heading"><div><span className="eyebrow">Customer reviews</span><h2>What our customers say.</h2></div></Reveal>
          <motion.div
            className="reviews-grid-react"
            initial="hidden"
            whileInView="show"
            viewport={{ once: true, amount: 0.2 }}
            variants={{ hidden: {}, show: { transition: { staggerChildren: 0.12 } } }}
          >
            {reviews.map((review) => <motion.article className="review-card-react" key={review.name} variants={fadeUp}>
              <div className="review-stars" aria-label="5 star review"><Star /><Star /><Star /><Star /><Star /></div>
              <p>"{review.quote}"</p>
              <b>{review.name}</b>
            </motion.article>)}
          </motion.div>
        </section>

        <section className="landing-map-section" id="visit">
          <Reveal tag="div" className="map-copy">
            <span className="eyebrow">Visit thecoffeerealm</span>
            <h2>Find us in North Fairview.</h2>
            <p><MapPin size={18} /> {store.address}</p>
            <p><Clock size={18} /> Weekdays and weekends: 10:00 AM to 12:00 MN</p>
            <a className="button button-dark" href={store.map} target="_blank" rel="noreferrer">Get directions</a>
          </Reveal>
          <Reveal tag="div" className="map-embed-react" delay={0.1}>
            <iframe title="thecoffeerealm North Fairview map" src={mapEmbed} loading="lazy" referrerPolicy="no-referrer-when-downgrade" />
          </Reveal>
        </section>
      </main>

      {modal}

      <footer className="landing-footer-react">
        <div>
          <Brand light />
          <p>Thoughtfully brewed in North Fairview, Quezon City.</p>
          <ul>
            <li><Phone size={16} /> {store.phone}</li>
            <li><Mail size={16} /> <a href={`mailto:${store.email}`}>{store.email}</a></li>
            <li><MapPin size={16} /> {store.address}</li>
          </ul>
        </div>
        <div>
          <h3>Follow us</h3>
          <div className="footer-social-links">
            <a href={store.facebook} target="_blank" rel="noreferrer"><Facebook size={18} /> Facebook</a>
            <a href="https://www.tiktok.com/@thecoffeerealmx" target="_blank" rel="noreferrer"><MessageCircle size={18} /> TikTok</a>
            <a href={store.instagram} target="_blank" rel="noreferrer"><Instagram size={18} /> Instagram</a>
          </div>
        </div>
        <div>
          <h3>Store details</h3>
          <p>Privacy Policy</p>
          <p>Terms & Conditions</p>
          <p>Order & Payment Policy</p>
          <p>Delivery & Pickup Policy</p>
        </div>
        <span className="footer-bottom-line">© 2026 thecoffeerealm. All rights reserved.</span>
      </footer>
    </div>
  )
}
