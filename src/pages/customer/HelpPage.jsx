import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { submitCustomerMessage } from '../../services/customerMessageService'

const helpGroups = [
  { title: 'Ordering guide', items: [['How do I browse the menu?', 'Explore the full selection of drinks, cakes, meals, and handcrafted treats from the Menu tab.'], ['Can I customize a product?', 'Yes. Select the available size, add-ons, sugar level, temperature, and special instructions before adding an item to your cart.'], ['How do I place an order?', 'Review your cart, proceed to checkout, then confirm your delivery or pickup details and payment method.']] },
  { title: 'Delivery guide', items: [['What information is required for delivery?', 'Choose delivery at checkout and provide a complete address, contact number, and delivery instructions.'], ['How is the delivery fee calculated?', 'Standard rates apply based on your distance from the North Fairview branch. The final fee is shown during checkout.'], ['Where can I track my delivery?', 'Open My Orders and select Track order to view the latest order status.']] },
  { title: 'Pickup guide', items: [['How does store pickup work?', 'Choose Store pickup during checkout and collect your order from the North Fairview branch.'], ['When should I arrive?', 'Please arrive within your selected pickup window to help us serve your order at peak freshness.'], ['What should I show the barista?', 'Provide your order number to the barista when you arrive.']] },
  { title: 'Payment guide', items: [['Which digital payments are accepted?', 'The available methods are shown according to your fulfillment choice.'], ['How should I submit proof of payment?', 'When proof is required, upload a clear screenshot showing the transaction details and reference number.'], ['Should I keep my payment reference?', 'Yes. Keep your transaction reference number available for payment or order inquiries.']] },
  { title: 'Common questions', items: [['Can I modify my order?', 'Once an order is confirmed, modifications are limited. Contact support immediately so the team can check its current preparation status.'], ['How long does payment validation take?', 'The store team usually verifies submitted digital payments within 5–15 minutes.']] },
  { title: 'Cancellations and refunds', items: [['When can I request cancellation?', 'You may request cancellation before or during the preparation stage. Requests are reviewed by staff before approval.'], ['What happens to an unpaid order?', 'An unpaid order may be cancelled immediately and will be marked as Cancelled.'], ['What happens if the order is already paid?', 'Paid orders require approval before cancellation and may proceed to refund processing.'], ['How can I track a refund?', 'The order details may show the refund as Pending or Refunded. You will be notified when its status changes.'], ['Will a cancelled order disappear?', 'No. Cancelled orders remain visible in My Orders with their details for reference.']] },
]

export default function HelpPage() {
  const { user, profile } = useAuth()
  const [sending, setSending] = useState(false)
  const [notice, setNotice] = useState({ kind: '', message: '' })

  const submitHelpRequest = async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    setSending(true)
    setNotice({ kind: '', message: '' })
    try {
      await submitCustomerMessage({
        category: 'help_request', source: 'help', name: values.name,
        email: values.email, subject: values.subject, message: values.message,
      })
      form.reset()
      setNotice({ kind: 'success', message: 'Your message was sent. The team will reply to your email as soon as possible.' })
    } catch (error) {
      setNotice({ kind: 'error', message: error.message || 'Your message could not be sent. Please try again.' })
    } finally {
      setSending(false)
    }
  }

  return <main className="customer-main">
    <section className="page-hero help-hero"><span>Support center · North Fairview</span><h1>How can we help?</h1><p>Find quick answers about ordering, fulfillment, payments, cancellations, and refunds.</p></section>
    <section className="help-layout">
      <div className="faq-column"><div className="section-heading"><div><span className="eyebrow">Frequently asked questions</span><h2>Everything you need to order smoothly.</h2></div></div><div className="faq-groups">{helpGroups.map((group, groupIndex) => <section className="faq-group" key={group.title}><h3>{group.title}</h3>{group.items.map(([question, answer], itemIndex) => <details key={question} open={groupIndex === 0 && itemIndex === 0}><summary>{question}<span aria-hidden="true">+</span></summary><p>{answer}</p></details>)}</section>)}</div></div>
      <aside className="help-contact"><span className="settings-kicker">Contact us</span><h2>Still need a hand?</h2><p>Send the store a message and include your order number when your question is about an existing order.</p><div className="contact-details"><p><b>Phone</b><a href="tel:+639975337958">+63 997 533 7958</a></p><p><b>Email</b><a href="mailto:main.thecoffeerealm@gmail.com">main.thecoffeerealm@gmail.com</a></p><p><b>Location</b><span>North Fairview, Quezon City</span></p></div>
        <form onSubmit={submitHelpRequest}>
          <label className="field"><span>Your name</span><input name="name" maxLength="120" autoComplete="name" defaultValue={profile?.full_name || profile?.username || ''} required /></label>
          <label className="field"><span>Email address</span><input name="email" maxLength="254" autoComplete="email" defaultValue={profile?.email || user?.email || ''} required type="email" /></label>
          <label className="field"><span>Subject</span><input name="subject" maxLength="180" required /></label>
          <label className="field"><span>How can we help?</span><textarea name="message" maxLength="5000" required placeholder="Tell us what happened or what you need help with." /></label>
          {notice.message && <p className={`message-form-notice is-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.message}</p>}
          <button className="primary-button full" type="submit" disabled={sending}>{sending ? 'Sending message…' : 'Send message'}</button>
        </form>
      </aside>
    </section>
  </main>
}
