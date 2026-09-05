import { useEffect, useMemo, useRef, useState } from 'react'
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
import { CONTENT_DEFAULTS, DEFAULT_TESTIMONIALS, SYSTEM_DEFAULTS, fetchPublicPortalData } from '../services/adminPortalConfigurationService'
import { fetchMenuCatalog } from '../services/menuService'

const mapEmbed = 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3859.0124735474096!2d121.05181751066577!3d14.711886674283116!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3397b1c4be33d913%3A0x2ab4591abe2ac00a!2sThe%20Coffee%20Realm%20-%20North%20Fairview!5e0!3m2!1sen!2sph!4v1764156842113!5m2!1sen!2sph'

const fadeUp = { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] } } }
const HERO_VIDEOS = ['/assets/vids/part0.mp4', '/assets/vids/part1.mp4', '/assets/vids/part2.mp4']
const HERO_FADE_SECONDS = 0.9
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
