import { Coffee, LogOut, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect, useRef } from 'react'

export default function LogoutConfirmModal({ open, busy = false, onCancel, onConfirm }) {
  const cancelButtonRef = useRef(null)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (!open) return undefined
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    cancelButtonRef.current?.focus()
    const handleEscape = (event) => {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleEscape)
    }
  }, [busy, onCancel, open])

  const backdropMotion = reduceMotion
    ? { initial: false, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.18 } }
  const modalMotion = reduceMotion
    ? { initial: false, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0 } }
    : {
        initial: { opacity: 0, scale: 0.97, y: 10 },
        animate: { opacity: 1, scale: 1, y: 0 },
        exit: { opacity: 0, scale: 0.985, y: 8 },
        transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
      }

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="payment-modal-backdrop auth-confirm-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !busy) onCancel()
          }}
          {...backdropMotion}
        >
          <motion.section
            className="payment-modal auth-confirm-modal"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="logout-confirm-title"
            aria-describedby="logout-confirm-copy"
            {...modalMotion}
          >
            <button
              className="payment-modal-close auth-confirm-close"
              type="button"
              onClick={onCancel}
              disabled={busy}
              aria-label="Close logout confirmation"
            >
              <X size={20} />
            </button>
            <div className="auth-confirm-scene" aria-hidden="true">
              <div className="auth-confirm-scene__halo" />
              <div className="auth-confirm-scene__leaf auth-confirm-scene__leaf--left" />
              <div className="auth-confirm-scene__leaf auth-confirm-scene__leaf--right" />
              <span className="auth-confirm-icon">
                <LogOut size={40} />
              </span>
              <div className="auth-confirm-cup">
                <Coffee size={26} />
                <img src="/images/coffeerealmlogo.png" alt="" />
              </div>
            </div>
            <span className="payment-modal-kicker auth-confirm-kicker">Account session</span>
            <h2 id="logout-confirm-title">Are you sure you want to log out?</h2>
            <span className="auth-confirm-divider" aria-hidden="true">❦</span>
            <p id="logout-confirm-copy">
              You will be signed out of your current session and returned to the login screen.
            </p>
            <div className="payment-modal-actions auth-confirm-actions">
              <button
                ref={cancelButtonRef}
                className="secondary-button"
                type="button"
                onClick={onCancel}
                disabled={busy}
              >
                <X size={16} />
                Cancel
              </button>
              <button className="primary-button" type="button" onClick={onConfirm} disabled={busy}>
                <LogOut size={17} />
                {busy ? 'Logging out...' : 'Log Out'}
              </button>
            </div>
            <div className="auth-confirm-landscape" aria-hidden="true">
              <span className="auth-confirm-landscape__ridge auth-confirm-landscape__ridge--back" />
              <span className="auth-confirm-landscape__ridge auth-confirm-landscape__ridge--front" />
              <span className="auth-confirm-landscape__mark">
                <img src="/images/coffeerealmlogo.png" alt="" />
              </span>
            </div>
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
