import { Coffee } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useEffect } from 'react'
import { buildAuthWelcomeMessage } from '../../lib/authFeedback'

export default function AuthWelcomePopup({ welcome, onClose }) {
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (!welcome) return undefined
    const timeoutId = window.setTimeout(onClose, 2400)
    return () => window.clearTimeout(timeoutId)
  }, [welcome, onClose])

  const transition = reduceMotion ? { duration: 0 } : { duration: 0.28, ease: [0.22, 1, 0.36, 1] }

  return (
    <AnimatePresence>
      {welcome ? (
        <motion.aside
          key={welcome.id}
          className="auth-welcome-popup"
          role="status"
          aria-live="polite"
          initial={reduceMotion ? false : { opacity: 0, y: 14, scale: 0.96 }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.98 }}
          transition={transition}
        >
          <span className="auth-welcome-popup__icon" aria-hidden="true">
            <Coffee size={18} />
          </span>
          <div className="auth-welcome-popup__copy">
            <b>Signed in</b>
            <p>{buildAuthWelcomeMessage(welcome.name)}</p>
          </div>
        </motion.aside>
      ) : null}
    </AnimatePresence>
  )
}
