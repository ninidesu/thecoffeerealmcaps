import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowRight, ChevronDown, Clock, Facebook, Instagram, Mail, MapPin, MessageCircle, Phone, Star } from 'lucide-react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import Brand from '../components/Brand'
import BestSellerCarousel from '../components/BestSellerCarousel'
import Reveal from '../components/Reveal'
import HowOrderingWorks from '../components/HowOrderingWorks'
import { store } from '../data/mockData'
import { bestSellerItems } from '../data/bestSellers'
import { useProductCustomization } from '../hooks/useProductCustomization'
import { submitCustomerMessage } from '../services/customerMessageService'
import { CONTENT_DEFAULTS, DEFAULT_TESTIMONIALS, SYSTEM_DEFAULTS, fetchPublicPortalData } from '../services/adminPortalConfigurationService'
import { fetchMenuCatalog } from '../services/menuService'

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
  const [inquiryType, setInquiryType] = useState('general')
  const [preorderStatus, setPreorderStatus] = useState({ kind: '', message: '' })
  const [submittingPreorder, setSubmittingPreorder] = useState(false)
  const [portalData, setPortalData] = useState({ content: CONTENT_DEFAULTS, system: SYSTEM_DEFAULTS, testimonials: DEFAULT_TESTIMONIALS })
  const [menuCatalog, setMenuCatalog] = useState([])
  const content = portalData.content
  const publicStore = { ...store, ...portalData.system.store }
  const featuredItems = useMemo(() => {
    const selected = (content.featured.itemIds || []).map(String)
    if (!selected.length || !menuCatalog.length) return bestSellerItems
    const byId = new Map(menuCatalog.map((item) => [String(item.id), item]))
    return selected.map((id) => byId.get(id)).filter(Boolean)
  }, [content.featured.itemIds, menuCatalog])

  const submitPreorderInquiry = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    const selectedType = values.inquiry_type || inquiryType
    const category = selectedType === 'pre_order' ? 'pre_order' : selectedType === 'report' ? 'help_request' : 'general_inquiry'
    const subject = selectedType === 'report' ? 'Report' : selectedType === 'pre_order' ? 'Pre-order inquiry' : 'General inquiry'
    setSubmittingPreorder(true)
    setPreorderStatus({ kind: '', message: '' })
    try {
      await submitCustomerMessage({
        category,
        source: 'landing',
        name: values.name,
        email: values.email,
        phone: values.phone,
        subject,
        message: values.message,
        inquiryType: selectedType,
        preferredDate: selectedType === 'pre_order' ? values.preferred_date : null,
        quantity: selectedType === 'pre_order' ? values.quantity : null,
      })
      form.reset()
      setInquiryType('general')
      setPreorderStatus({ kind: 'success', message: 'Your message was sent. Our team will reply by email after reviewing the details.' })
    } catch (error) {
      setPreorderStatus({ kind: 'error', message: error.message || 'Your inquiry could not be sent. Please try again.' })
    } finally {
      setSubmittingPreorder(false)
    }
  }

  useEffect(() => {
    let active = true
    Promise.all([fetchPublicPortalData(), fetchMenuCatalog()]).then(([configuration, catalog]) => {
      if (!active) return
      setPortalData(configuration)
      setMenuCatalog(catalog.products || [])
    }).catch(() => {})
    return () => { active = false }
  }, [])

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
            <motion.span className="eyebrow" variants={fadeUp}>{content.hero.eyebrow}</motion.span>
            <motion.h1 variants={fadeUp}>{content.hero.title}</motion.h1>
            <motion.p variants={fadeUp}>{content.hero.body}</motion.p>
            <motion.div className="hero-actions" variants={fadeUp}>
              <Link className="button button-light" to={content.hero.primaryHref || '/menu'}>{content.hero.primaryLabel}</Link>
              <a className="text-link" href={content.hero.secondaryHref || '#customer-inquiry-form'}>{content.hero.secondaryLabel} <ArrowRight size={17} /></a>
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

        {content.featured.visible && <section className="section landing-menu-preview" id="menu">
          <Reveal tag="div" className="section-heading">
            <div><span className="eyebrow">{content.featured.eyebrow}</span><h2>{content.featured.title}</h2></div>
            <Link className="text-link dark" to="/menu">See full menu <ArrowRight size={17} /></Link>
          </Reveal>
          <Reveal tag="div" delay={0.1}>
            <BestSellerCarousel items={featuredItems} onAddToCart={addToCart} />
          </Reveal>
        </section>}

        {content.inquiry.visible && <section className="landing-inquiry" id="preorder">
          <motion.div
            className="inquiry-editorial-panel"
            initial={{ opacity: 0, x: -38 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, amount: 0.25 }}
            transition={{ duration: 0.72, ease: [0.22, 1, 0.36, 1] }}
          >
            <div className="inquiry-editorial-copy">
              <span className="inquiry-kicker">{content.inquiry.kicker}</span>
              <h2>{content.inquiry.title}</h2>
              <div className="inquiry-response-note"><Mail size={18} aria-hidden="true" /><span><b>{content.inquiry.responseTitle}</b><small>{content.inquiry.responseBody}</small></span></div>
            </div>
            <div className="inquiry-media">
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
              <div className="inquiry-media-caption"><span>Whole cake pre-orders</span></div>
            </div>
          </motion.div>
          <Reveal tag="div" className="inquiry-form-panel" id="customer-inquiry-form" delay={0.08} y={26}>
            <header className="inquiry-form-heading"><span>Customer inquiry</span><h2>Send a message</h2><p>Share the essentials below. Fields marked with an asterisk are required.</p></header>
            <form className="preorder-form inquiry-form" onSubmit={submitPreorderInquiry}>
              <label className="inquiry-select-field">
                <span>Inquiry type *</span>
                <span className="inquiry-select-shell">
                  <select name="inquiry_type" value={inquiryType} onChange={(event) => { setInquiryType(event.target.value); setPreorderStatus({ kind: '', message: '' }) }} aria-describedby="inquiry-type-help">
                    <option value="general">General</option>
                    <option value="pre_order">Pre-order</option>
                    <option value="report">Report</option>
                  </select>
                  <ChevronDown size={18} aria-hidden="true" />
                </span>
                <small id="inquiry-type-help">{inquiryType === 'pre_order' ? 'Use this for advance orders. We’ll ask for your preferred pickup date and estimated quantity.' : inquiryType === 'report' ? 'Use this to report an issue or concern to our support team.' : 'Use this for questions, feedback, and everything else.'}</small>
              </label>
              <div className="preorder-contact-grid">
                <label>
                  <span>Full name *</span>
                  <input name="name" type="text" maxLength="120" autoComplete="name" required placeholder="Your full name" />
                </label>
                <label>
                  <span>Email address *</span>
                  <input name="email" type="email" maxLength="254" autoComplete="email" required placeholder="name@example.com" />
                </label>
                <label>
                  <span>Contact number *</span>
                  <input name="phone" type="tel" maxLength="40" autoComplete="tel" required placeholder="09XXXXXXXXX" />
                </label>
              </div>
              {inquiryType === 'pre_order' && <motion.div className="preorder-conditional-fields" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: 'easeOut' }}>
                <label>
                  <span>Preferred pickup date *</span>
                  <input name="preferred_date" type="date" required />
                </label>
                <label>
                  <span>Estimated quantity or serving size *</span>
                  <input name="quantity" type="text" maxLength="120" required placeholder="e.g. 1 whole cake or 12–15 pax" />
                </label>
                <p className="preorder-lead-time-note"><Clock size={17} aria-hidden="true" /><span>Please order <b>2–3 days ahead</b> for pre-orders or bulk orders.</span></p>
              </motion.div>}
              <label>
                <span>Message *</span>
                <textarea name="message" required maxLength="5000" placeholder={inquiryType === 'pre_order' ? 'Tell us what you would like to order and any important details.' : inquiryType === 'report' ? 'Describe the issue, what happened, and any details that can help us review it.' : 'How can we help?'} />
              </label>
              {preorderStatus.message && <p className={`message-form-notice is-${preorderStatus.kind}`} role={preorderStatus.kind === 'error' ? 'alert' : 'status'}>{preorderStatus.message}</p>}
              <div className="inquiry-form-action"><small>{inquiryType === 'pre_order' ? 'Submitting does not confirm the order. Availability will still be reviewed.' : 'We’ll use your email address to send the team’s reply.'}</small><button type="submit" className="button button-dark" disabled={submittingPreorder}>{submittingPreorder ? 'Sending…' : inquiryType === 'pre_order' ? 'Send pre-order request' : inquiryType === 'report' ? 'Send report' : 'Send inquiry'}<ArrowRight size={17} aria-hidden="true" /></button></div>
            </form>
          </Reveal>
        </section>}

        <section className="story landing-about" id="about">
          <Reveal tag="div" className="story-copy">
            <span className="eyebrow">{content.about.eyebrow}</span>
            <h2>{content.about.title}</h2>
            {(content.about.paragraphs || []).filter(Boolean).map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
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
            {portalData.testimonials.map((review) => <motion.article className="review-card-react" key={review.id || review.name} variants={fadeUp}>
              <div className="review-stars" aria-label={`${review.rating || 5} star review`}>{Array.from({ length: review.rating || 5 }, (_, index) => <Star key={index}/>)}</div>
              <p>"{review.quote}"</p>
              <b>{review.name}</b>
            </motion.article>)}
          </motion.div>
        </section>

        <section className="landing-map-section" id="visit">
          <Reveal tag="div" className="map-copy">
            <span className="eyebrow">Visit thecoffeerealm</span>
            <h2>Find us in North Fairview.</h2>
            <p><MapPin size={18} /> {publicStore.address}</p>
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
          <p>{content.footer.tagline}</p>
          <ul>
            <li><Phone size={16} /> {publicStore.phone}</li>
            <li><Mail size={16} /> <a href={`mailto:${publicStore.email}`}>{publicStore.email}</a></li>
            <li><MapPin size={16} /> {publicStore.address}</li>
          </ul>
        </div>
        <div>
          <h3>Follow us</h3>
          <div className="footer-social-links">
            <a href={content.footer.facebookUrl} target="_blank" rel="noreferrer"><Facebook size={18} /> Facebook</a>
            <a href={content.footer.tiktokUrl} target="_blank" rel="noreferrer"><MessageCircle size={18} /> TikTok</a>
            <a href={content.footer.instagramUrl} target="_blank" rel="noreferrer"><Instagram size={18} /> Instagram</a>
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
