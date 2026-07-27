import { ArrowRight, Clock, Facebook, Instagram, Mail, MapPin, MessageCircle, Phone, Star } from 'lucide-react'
import { Link } from 'react-router-dom'
import Brand from '../components/Brand'
import { menuItems, store } from '../data/mockData'

const bestSellers = menuItems.filter((item) => [4, 8, 15, 16].includes(item.id))

const reviews = [
  { name: 'Mika S.', quote: 'Their coffee and cheesecakes feel homemade in the best way. Cozy place, kind staff, and always worth coming back to.' },
  { name: 'Ari R.', quote: 'The cookie boxes are my go-to gift. Every flavor tastes fresh and the packaging feels thoughtful.' },
  { name: 'Nico C.', quote: 'Perfect North Fairview coffee stop. Good drinks, comforting meals, and a calm spot to work or meet friends.' },
]

const mapEmbed = 'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3859.0124735474096!2d121.05181751066577!3d14.711886674283116!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x3397b1c4be33d913%3A0x2ab4591abe2ac00a!2sThe%20Coffee%20Realm%20-%20North%20Fairview!5e0!3m2!1sen!2sph!4v1764156842113!5m2!1sen!2sph'

export default function HomePage() {
  return (
    <div className="storefront customer-landing">
<main>
        <section className="hero landing-hero" id="home">
          <div className="hero-copy">
            <span className="eyebrow">thecoffeerealm in North Fairview</span>
            <h1>Fresh coffee, homemade sweets, and slow little moments.</h1>
            <p>We serve comforting coffee-based drinks, freshly baked cookies, homemade cakes, pasta, rice meals, toasts, and snacks in a warm neighborhood space.</p>
            <div className="hero-actions">
              <Link className="button button-light" to="/menu">View full menu</Link>
              <a className="text-link" href="#preorder">Send a pre-order inquiry <ArrowRight size={17} /></a>
            </div>
            <div className="hero-proof">
              <div className="avatar-stack"><span>TC</span><span>CR</span><span>QC</span></div>
              <span><b>Customer favorites</b> include tiramisu, burnt cheesecake, and cookie boxes.</span>
            </div>
          </div>
        </section>

        <section className="marquee" aria-label="thecoffeerealm highlights">
          <span>Homemade cakes</span><i>*</i><span>Fresh cookie boxes</span><i>*</i><span>Coffee-based drinks</span><i>*</i><span>North Fairview cafe</span>
        </section>

        <section className="section landing-menu-preview" id="menu">
          <div className="section-heading">
            <div><span className="eyebrow">Customer favorites</span><h2>Bestsellers from the realm.</h2></div>
            <Link className="text-link dark" to="/menu">See full menu <ArrowRight size={17} /></Link>
          </div>
          <div className="product-grid bestsellers-grid">
            {bestSellers.map((item) => <article className="product-card" key={item.id}>
              <div className="product-image"><img src={item.image} alt={item.name} /><span>Best Seller</span></div>
              <div className="product-body"><small>{item.category}</small><h3>{item.name}</h3><p>{item.description || 'A customer favorite from the shop menu.'}</p><div><b>{item.price ? `PHP ${Number(item.price).toFixed(2)}` : 'Menu favorite'}</b><Link to={`/menu/${item.id}`} aria-label={`Customize ${item.name}`}><ArrowRight size={18} /></Link></div></div>
            </article>)}
          </div>
        </section>

        <section className="landing-preorder" id="preorder">
          <div className="preorder-visual"><img src="/images/menu/BurntBasqueCheesecake.jpg" alt="thecoffeerealm cake for pre-order" /></div>
          <div className="preorder-copy">
            <span className="eyebrow">Pre-order and inquiries</span>
            <h2>Planning a whole cake, cookie box, or coffee run?</h2>
            <p>Send us your inquiry and we will help with availability, serving size, pickup schedule, and order details. Whole cakes are available for pre-order and intimate celebrations.</p>
            <form className="preorder-form" onSubmit={(event) => event.preventDefault()}>
              <div><input type="email" placeholder="Email address" aria-label="Email address" /><input type="tel" placeholder="Contact number" aria-label="Contact number" /></div>
              <input type="text" placeholder="Subject" aria-label="Subject" />
              <textarea placeholder="Message" aria-label="Message" />
              <button type="submit" className="button button-dark">Send Inquiry</button>
            </form>
          </div>
        </section>

        <section className="story landing-about" id="about">
          <div className="story-copy">
            <span className="eyebrow">About us</span>
            <h2>A cozy place for coffee, cakes, and conversations.</h2>
            <p>We serve freshly baked cookies, homemade cakes, and comforting coffee-based drinks in a space made for slow days, warm conversations, or solo work dates.</p>
            <p>We also offer pasta, rice meals, toasts, and snacks. Some bestsellers include homemade tiramisu, biscoff burnt cheesecake, and fresh cookie boxes for gifting or sharing.</p>
          </div>
        </section>

        <section className="section landing-reviews" id="reviews">
          <div className="section-heading"><div><span className="eyebrow">Customer reviews</span><h2>What our customers say.</h2></div></div>
          <div className="reviews-grid-react">
            {reviews.map((review) => <article className="review-card-react" key={review.name}>
              <div className="review-stars" aria-label="5 star review"><Star /><Star /><Star /><Star /><Star /></div>
              <p>"{review.quote}"</p>
              <b>{review.name}</b>
            </article>)}
          </div>
        </section>

        <section className="landing-map-section" id="visit">
          <div className="map-copy">
            <span className="eyebrow">Visit thecoffeerealm</span>
            <h2>Find us in North Fairview.</h2>
            <p><MapPin size={18} /> {store.address}</p>
            <p><Clock size={18} /> Weekdays and weekends: 10:00 AM to 12:00 MN</p>
            <a className="button button-dark" href={store.map} target="_blank" rel="noreferrer">Get directions</a>
          </div>
          <div className="map-embed-react"><iframe title="thecoffeerealm North Fairview map" src={mapEmbed} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /></div>
        </section>
      </main>

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
