import { useEffect, useRef, useState } from 'react'
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
const HERO_VIDEOS = ['/assets/vids/part0.mp4', '/assets/vids/part1.mp4', '/assets/vids/part2.mp4']
const HERO_FADE_SECONDS = 0.9
const PREORDER_CAKES = [
  { src: '/assets/img/Cakes/BurntBasqueCheesecake.jpg', alt: 'Burnt Basque Cheesecake' },
  { src: '/assets/img/Cakes/BlueberryCheesecake.jpg', alt: 'Blueberry Cheesecake' },
  { src: '/assets/img/Cakes/MatchaCheesecake.jpg', alt: 'Matcha Cheesecake' },
  { src: '/assets/img/Cakes/LecheFlanCheesecake.jpg', alt: 'Leche Flan Cheesecake' },
  { src: '/assets/img/Cakes/BurntBiscoffCheesecake.jpg', alt: 'Biscoff Burnt Cheesecake' },
  { src: '/assets/img/Cakes/CarrotWalnutCake.jpg', alt: 'Carrot Walnut Cake' },
  { src: '/assets/img/Cakes/RedVelvetCake.jpg', alt: 'Red Velvet Cake' },
  { src: '/assets/img/Cakes/TiramisuCake.jpg', alt: 'Tiramisu Cake' },
]

export default function HomePage() {
  const { addToCart, modal } = useProductCustomization({
    alwaysCustomize: true,
    modalVariant: 'menu-detail',
  })
  const videoRefs = useRef([])
  const activeLayerRef = useRef(0)
  const currentVideoIndexRef = useRef(0)
  const isTransitioningRef = useRef(false)
  const resetTransitionRef = useRef(null)
  const [activeLayer, setActiveLayer] = useState(0)
  const [layerSources, setLayerSources] = useState([HERO_VIDEOS[0], HERO_VIDEOS[1]])
  const [activeCakeSlide, setActiveCakeSlide] = useState(0)

  useEffect(() => {
    const initialVideo = videoRefs.current[0]
    if (!initialVideo) return

    initialVideo.currentTime = 0
    initialVideo.play().catch(() => {})

    return () => {
      if (resetTransitionRef.current) window.clearTimeout(resetTransitionRef.current)
    }
  }, [])

  useEffect(() => {
    const cakeTimer = window.setInterval(() => {
      setActiveCakeSlide((current) => (current + 1) % PREORDER_CAKES.length)
    }, 4200)
    return () => window.clearInterval(cakeTimer)
  }, [])

  const transitionHeroVideo = () => {
    if (isTransitioningRef.current) return

    const outgoingLayer = activeLayerRef.current
    const incomingLayer = 1 - outgoingLayer
    const nextVideoIndex = (currentVideoIndexRef.current + 1) % HERO_VIDEOS.length
    const followingVideoIndex = (nextVideoIndex + 1) % HERO_VIDEOS.length
    const incomingVideo = videoRefs.current[incomingLayer]
    const outgoingVideo = videoRefs.current[outgoingLayer]

    if (!incomingVideo || !outgoingVideo) return

    isTransitioningRef.current = true
    incomingVideo.currentTime = 0
    incomingVideo.play().catch(() => {})
    activeLayerRef.current = incomingLayer
    currentVideoIndexRef.current = nextVideoIndex
    setActiveLayer(incomingLayer)

    if (resetTransitionRef.current) window.clearTimeout(resetTransitionRef.current)
    resetTransitionRef.current = window.setTimeout(() => {
      outgoingVideo.pause()
      outgoingVideo.currentTime = 0
      setLayerSources((currentSources) => {
        const nextSources = [...currentSources]
        nextSources[outgoingLayer] = HERO_VIDEOS[followingVideoIndex]
        return nextSources
      })
      isTransitioningRef.current = false
    }, HERO_FADE_SECONDS * 1000)
  }

  const handleHeroVideoTimeUpdate = (layerIndex) => {
    if (layerIndex !== activeLayerRef.current || isTransitioningRef.current) return
    const video = videoRefs.current[layerIndex]
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return
    if (video.duration - video.currentTime <= HERO_FADE_SECONDS) transitionHeroVideo()
  }

  const handleHeroVideoEnded = (layerIndex) => {
    if (layerIndex === activeLayerRef.current) transitionHeroVideo()
  }

  return (
    <div className="storefront customer-landing">
<main>
        <section className="hero landing-hero" id="home">
          <div className="landing-hero-media" aria-hidden="true">
            {layerSources.map((source, layerIndex) => (
              <video
                key={`${layerIndex}-${source}`}
                ref={(element) => { videoRefs.current[layerIndex] = element }}
                className={`landing-hero-video ${activeLayer === layerIndex ? 'is-active' : ''}`}
                src={source}
                muted
                playsInline
                autoPlay={layerIndex === 0}
                preload="auto"
                onTimeUpdate={() => handleHeroVideoTimeUpdate(layerIndex)}
                onEnded={() => handleHeroVideoEnded(layerIndex)}
              />
            ))}
          </div>
          <div className="landing-hero-overlay" aria-hidden="true" />
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
          <motion.div
            className="preorder-visual"
            initial={{ opacity: 0, x: -38 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.72, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="preorder-visual-copy">
              <span className="preorder-badge">Whole Cakes Available for Pre-Order</span>
              <p>Please order 2-3 days in advance.</p>
            </div>
            <div className="preorder-slideshow" aria-label="Featured whole cakes for pre-order">
              {PREORDER_CAKES.map((cake, index) => (
                <img
                  key={cake.src}
                  src={cake.src}
                  alt={cake.alt}
                  className={`preorder-slide-image ${activeCakeSlide === index ? 'is-active' : ''}`}
                />
              ))}
            </div>
          </motion.div>
          <Reveal tag="div" className="preorder-copy" delay={0.08} y={26}>
            <span className="eyebrow">Pre-order and inquiries</span>
            <h2>Planning a whole cake, cookie box, or coffee run?</h2>
            <p>Tell us what you need and we'll confirm availability and details.</p>
            <form className="preorder-form" onSubmit={(event) => event.preventDefault()}>
              <div>
                <label>
                  <span>Inquiry type</span>
                  <select aria-label="Inquiry type" defaultValue="">
                    <option value="" disabled>Select inquiry type</option>
                    <option value="whole-cake">Whole Cake</option>
                    <option value="cookie-box">Cookie Box</option>
                    <option value="bulk-coffee-order">Bulk Coffee Order</option>
                    <option value="other">Other</option>
                  </select>
                </label>
                <label>
                  <span>Preferred pickup date</span>
                  <input type="date" aria-label="Preferred pickup date" />
                </label>
              </div>
              <div>
                <label>
                  <span>Estimated quantity or serving size</span>
                  <input type="text" placeholder="e.g. 1 whole cake or 12-15 pax" aria-label="Estimated quantity or serving size" />
                </label>
                <label>
                  <span>Contact number</span>
                  <input type="tel" placeholder="09XXXXXXXXX" aria-label="Contact number" />
                </label>
              </div>
              <label>
                <span>Email address</span>
                <input type="email" placeholder="name@example.com" aria-label="Email address" />
              </label>
              <label>
                <span>Message</span>
                <textarea placeholder="Tell us the flavor, preferred schedule, and anything else we should prepare for your order." aria-label="Message" />
              </label>
              <button type="submit" className="button button-dark">Submit Pre-Order Inquiry</button>
              <small className="preorder-disclaimer">Submitting this form does not confirm the order. Availability will still be reviewed and verified by the team.</small>
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
