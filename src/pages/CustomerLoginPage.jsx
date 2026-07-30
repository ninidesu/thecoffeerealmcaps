import { ArrowLeft, Eye, EyeOff, Lock, Mail, ShieldCheck, User, UserPlus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

const otpDigits = 6

export default function CustomerLoginPage({ initialMode = 'login' }) {
  const navigate = useNavigate()
  const location = useLocation()
  const verificationOtpRefs = useRef([])
  const forgotOtpRefs = useRef([])
  const [mode, setMode] = useState(initialMode)
  const [showLoginPassword, setShowLoginPassword] = useState(false)
  const [showRegisterPassword, setShowRegisterPassword] = useState(false)
  const [forgotOpen, setForgotOpen] = useState(false)
  const [forgotStep, setForgotStep] = useState('email')
  const [forgotOtp, setForgotOtp] = useState(Array(otpDigits).fill(''))
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [otpOpen, setOtpOpen] = useState(false)
  const [registeredEmail, setRegisteredEmail] = useState('')
  const [pendingUsername, setPendingUsername] = useState('')
  const [otpCode, setOtpCode] = useState(Array(otpDigits).fill(''))
  const [authMessage, setAuthMessage] = useState(location.state?.authMessage || '')
  const [authError, setAuthError] = useState('')
  const [loading, setLoading] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')

  useEffect(() => {
    if (!location.state?.openForgotPassword) return
    setAuthError('')
    setAuthMessage(location.state?.authMessage || '')
    setForgotEmail(location.state?.forgotEmail || '')
    setForgotStep('email')
    setForgotOtp(Array(otpDigits).fill(''))
    setNewPassword('')
    setConfirmPassword('')
    setForgotOpen(true)
  }, [location.state])

  useEffect(() => {
    if (!otpOpen) return
    focusOtpGroup(verificationOtpRefs, otpCode)
  }, [otpCode, otpOpen])

  useEffect(() => {
    if (forgotStep !== 'otp') return
    focusOtpGroup(forgotOtpRefs, forgotOtp)
  }, [forgotOtp, forgotStep])

  async function submitLogin(event) {
    event.preventDefault()
    setAuthError('')
    setAuthMessage('')
    if (!isSupabaseConfigured) return setAuthError('Supabase is not configured yet.')
    const data = new FormData(event.currentTarget)
    const email = String(data.get('email') || '').trim()
    const password = String(data.get('password') || '')
    if (!email || !password) return setAuthError('Please enter your email and password.')
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setLoading(false)
    if (error) return setAuthError(error.message)
    navigate(location.state?.from || '/menu')
  }

  async function submitRegister(event) {
    event.preventDefault()
    setAuthError('')
    setAuthMessage('')
    if (!isSupabaseConfigured) return setAuthError('Supabase is not configured yet.')
    const data = new FormData(event.currentTarget)
    const username = String(data.get('username') || '').trim()
    const email = String(data.get('email') || '').trim()
    const password = String(data.get('password') || '')
    if (username.length < 3) return setAuthError('Username must be at least 3 characters long.')
    if (!email) return setAuthError('Email address is required.')
    if (password.length < 6 || !/\d/.test(password)) return setAuthError('Password must be at least 6 characters and include at least 1 number.')
    setLoading(true)
    const { data: signupData, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { username, full_name: username, role: 'customer' } },
    })
    setLoading(false)
    if (error) return setAuthError(error.message || 'Unable to send OTP right now.')
    if (signupData.session) return navigate(location.state?.from || '/menu')
    setRegisteredEmail(email)
    setPendingUsername(username)
    setOtpCode(Array(otpDigits).fill(''))
    setOtpOpen(true)
    setAuthMessage('We sent a 6-digit thecoffeerealm verification code to your email. Check your inbox to complete registration.')
  }

  async function verifyOtp() {
    setAuthError('')
    if (!registeredEmail) return setAuthError('Missing email address for verification.')
    const token = otpCode.join('')
    if (token.length !== otpDigits) return setAuthError('Enter the 6-digit OTP code.')
    setLoading(true)
    const { error } = await supabase.auth.verifyOtp({
      email: registeredEmail,
      token,
      type: 'signup',
    })
    setLoading(false)
    if (error) return setAuthError(error.message || 'Unable to verify OTP right now.')
    setOtpOpen(false)
    setAuthMessage(`Account verified. Welcome, ${pendingUsername || 'customer'}!`)
    navigate(location.state?.from || '/menu')
  }

  async function resendOtp() {
    setAuthError('')
    if (!registeredEmail) return setAuthError('Missing email address for verification.')
    setLoading(true)
    const { error } = await supabase.auth.resend({ type: 'signup', email: registeredEmail })
    setLoading(false)
    if (error) return setAuthError(error.message || 'Unable to resend OTP right now.')
    setAuthMessage('A new 6-digit verification code was sent.')
  }
  async function submitForgotPassword(event) {
    event.preventDefault()
    setAuthError('')
    setAuthMessage('')
    if (!isSupabaseConfigured) return setAuthError('Supabase is not configured yet.')
    const trimmedEmail = forgotEmail.trim()
    if (!trimmedEmail) return setAuthError('Enter your email address first.')
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) return setAuthError('Enter a valid email address.')
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(trimmedEmail)
    setLoading(false)
    // Supabase intentionally does not reveal whether the email is registered
    // (avoids account enumeration) — a success response here does not mean
    // the address exists, only that the request was accepted.
    if (error) return setAuthError(error.message || 'Could not send the reset code. Please try again.')
    setForgotOtp(Array(otpDigits).fill(''))
    setForgotStep('otp')
    setAuthMessage('A 6-digit password reset code was sent to your email.')
  }

  async function verifyForgotOtp() {
    setAuthError('')
    const token = forgotOtp.join('')
    if (token.length !== otpDigits) return setAuthError('Enter the 6-digit OTP code.')
    setLoading(true)
    const { error } = await supabase.auth.verifyOtp({ email: forgotEmail.trim(), token, type: 'recovery' })
    setLoading(false)
    if (error) return setAuthError(error.message || 'Unable to verify the reset code.')
    setForgotStep('password')
    setAuthMessage('')
  }

  async function submitNewPassword(event) {
    event.preventDefault()
    setAuthError('')
    if (newPassword.length < 6 || !/\d/.test(newPassword)) return setAuthError('Password must be at least 6 characters and include at least 1 number.')
    if (newPassword !== confirmPassword) return setAuthError('The passwords do not match.')
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (!error) await supabase.auth.signOut()
    setLoading(false)
    if (error) return setAuthError(error.message || 'Unable to update your password.')
    closeForgotPassword()
    setAuthMessage('Password changed successfully. You can now log in with your new password.')
  }

  async function resendForgotOtp() {
    setAuthError('')
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim())
    setLoading(false)
    if (error) return setAuthError(error.message || 'Unable to resend the reset code.')
    setAuthMessage('A new 6-digit password reset code was sent.')
  }

  function openForgotPassword() {
    setAuthError('')
    setAuthMessage('')
    setForgotStep('email')
    setForgotOtp(Array(otpDigits).fill(''))
    setNewPassword('')
    setConfirmPassword('')
    setForgotOpen(true)
  }

  function closeForgotPassword() {
    setForgotOpen(false)
    setForgotStep('email')
    setForgotOtp(Array(otpDigits).fill(''))
    setNewPassword('')
    setConfirmPassword('')
  }
  function setVerificationOtpDigit(index, value) {
    setOtpCode((current) => current.map((digit, digitIndex) => digitIndex === index ? value : digit))
  }

  function setForgotOtpDigit(index, value) {
    setForgotOtp((current) => current.map((digit, digitIndex) => digitIndex === index ? value : digit))
  }

  return (
    <main className="legacy-customer-auth-page">
      <Link className="legacy-auth-home" to="/"><ArrowLeft size={17} /> Back to Home</Link>

      <section className={`legacy-auth-container ${mode === 'register' ? 'active' : ''}`}>
        <div className="legacy-auth-form login">
          <form onSubmit={submitLogin} autoComplete="off">
            <h1>Customer Login</h1>
            {authError && mode === 'login' ? <AuthNotice variant="error" message={authError} /> : null}
            {authMessage && mode === 'login' ? <AuthNotice variant="success" message={authMessage} /> : null}
            <label className="legacy-auth-input">
              <span>Email address</span>
              <div><Mail size={19} /><input name="email" type="email" placeholder="Enter your email" /></div>
            </label>
            <label className="legacy-auth-input">
              <span>Password <button type="button" onClick={openForgotPassword}>Forgot Password?</button></span>
              <div><Lock size={19} /><input name="password" type={showLoginPassword ? 'text' : 'password'} placeholder="Enter your password" /><button type="button" aria-label="Toggle password visibility" onClick={() => setShowLoginPassword((value) => !value)}>{showLoginPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
            </label>
            <button type="submit" className="legacy-auth-submit" disabled={loading}>{loading ? 'PLEASE WAIT...' : 'LOGIN'}</button>
          </form>
        </div>

        <div className="legacy-auth-form register">
          <form onSubmit={submitRegister}>
            <h1>Registration</h1>
            {authError && mode === 'register' ? <AuthNotice variant="error" message={authError} /> : null}
            {authMessage && mode === 'register' ? <AuthNotice variant="success" message={authMessage} /> : null}
            <label className="legacy-auth-input">
              <span>Username</span>
              <div><User size={19} /><input name="username" type="text" placeholder="Choose a username" minLength="3" /></div>
            </label>
            <label className="legacy-auth-input">
              <span>Email address</span>
              <div><Mail size={19} /><input name="email" type="email" placeholder="Enter your email" /></div>
            </label>
            <label className="legacy-auth-input">
              <span>Password</span>
              <div><Lock size={19} /><input name="password" type={showRegisterPassword ? 'text' : 'password'} placeholder="Create a password" /><button type="button" aria-label="Toggle password visibility" onClick={() => setShowRegisterPassword((value) => !value)}>{showRegisterPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
            </label>
            <button type="submit" className="legacy-auth-submit" disabled={loading}><UserPlus size={18} /> {loading ? 'SENDING...' : 'CREATE ACCOUNT'}</button>
          </form>
        </div>

        <div className="legacy-auth-toggle">
          <div className="legacy-auth-panel toggle-left">
            <img src="/images/coffeerealmlogo.png" alt="thecoffeerealm logo" />
            <h2>Hello, Welcome!</h2>
            <p>Don't have an account?</p>
            <button type="button" onClick={() => { setAuthError(''); setAuthMessage(''); setMode('register') }}>Register Now!</button>
          </div>
          <div className="legacy-auth-panel toggle-right">
            <img src="/images/coffeerealmlogo.png" alt="thecoffeerealm logo" />
            <h2>Welcome Back!</h2>
            <p>Already have an account?</p>
            <button type="button" onClick={() => { setAuthError(''); setAuthMessage(''); setMode('login') }}>Login!</button>
          </div>
        </div>
      </section>

      {forgotOpen ? <AuthModal title="Reset Password" onClose={closeForgotPassword}>
        {forgotStep === 'email' ? <form onSubmit={submitForgotPassword}>
          <p>Enter your account email and we will send a 6-digit password reset code.</p>
          {authError ? <AuthNotice variant="error" message={authError} /> : null}
          <label className="legacy-auth-input"><span>Email address</span><div><Mail size={19} /><input type="email" value={forgotEmail} onChange={(event) => setForgotEmail(event.target.value)} placeholder="Enter your email" /></div></label>
          <button type="submit" className="legacy-auth-submit" disabled={loading}>{loading ? 'SENDING...' : 'SEND OTP CODE'}</button>
        </form> : null}
        {forgotStep === 'otp' ? <div>
          <div className="legacy-otp-icon"><ShieldCheck size={30} /></div>
          <p>Enter the 6-digit password reset code sent to <b>{forgotEmail}</b>.</p>
          {authError ? <AuthNotice variant="error" message={authError} /> : null}
          {authMessage ? <AuthNotice variant="success" message={authMessage} /> : null}
          <div className="legacy-otp-inputs" aria-label="Password reset OTP inputs" onPaste={(event) => handleOtpPaste(event, forgotOtp, setForgotOtpDigit, forgotOtpRefs)}>{forgotOtp.map((digit, index) => <input key={index} ref={(element) => { forgotOtpRefs.current[index] = element }} value={digit} onChange={(event) => handleOtpInput(index, event.target.value, forgotOtp, setForgotOtpDigit, forgotOtpRefs)} onKeyDown={(event) => handleOtpKeyDown(index, event, forgotOtp, setForgotOtpDigit, forgotOtpRefs)} onFocus={(event) => event.target.select()} inputMode="numeric" maxLength={otpDigits} aria-label={`Reset OTP digit ${index + 1}`} />)}</div>
          <button type="button" className="legacy-auth-submit" onClick={verifyForgotOtp} disabled={loading}>{loading ? 'VERIFYING...' : 'VERIFY OTP'}</button>
          <button type="button" className="legacy-auth-link-button" onClick={resendForgotOtp} disabled={loading}>Resend code</button>
        </div> : null}
        {forgotStep === 'password' ? <form onSubmit={submitNewPassword}>
          <p>Your code is verified. Create a new password for your account.</p>
          {authError ? <AuthNotice variant="error" message={authError} /> : null}
          <label className="legacy-auth-input"><span>New password</span><div><Lock size={19} /><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="Enter new password" /></div></label>
          <label className="legacy-auth-input"><span>Confirm new password</span><div><Lock size={19} /><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} placeholder="Repeat new password" /></div></label>
          <p className="legacy-auth-hint">Use at least 6 characters with at least 1 number.</p>
          <button type="submit" className="legacy-auth-submit" disabled={loading}>{loading ? 'UPDATING...' : 'UPDATE PASSWORD'}</button>
        </form> : null}
      </AuthModal> : null}
      {otpOpen ? <AuthModal title="Verify your account" onClose={() => setOtpOpen(false)}>
        <div className="legacy-otp-icon"><ShieldCheck size={30} /></div>
        <p>We sent a 6-digit verification code to <b>{registeredEmail}</b>. Enter the code here to create your account.</p>
        {authError ? <AuthNotice variant="error" message={authError} /> : null}
        {authMessage ? <AuthNotice variant="success" message={authMessage} /> : null}
        <div className="legacy-otp-inputs" aria-label="OTP code inputs" onPaste={(event) => handleOtpPaste(event, otpCode, setVerificationOtpDigit, verificationOtpRefs)}>{otpCode.map((digit, index) => <input key={index} ref={(element) => { verificationOtpRefs.current[index] = element }} value={digit} onChange={(event) => handleOtpInput(index, event.target.value, otpCode, setVerificationOtpDigit, verificationOtpRefs)} onKeyDown={(event) => handleOtpKeyDown(index, event, otpCode, setVerificationOtpDigit, verificationOtpRefs)} onFocus={(event) => event.target.select()} inputMode="numeric" maxLength={otpDigits} aria-label={`OTP digit ${index + 1}`} />)}</div>
        <button type="button" className="legacy-auth-submit" onClick={verifyOtp} disabled={loading}>{loading ? 'VERIFYING...' : 'VERIFY OTP'}</button>
        <button type="button" className="legacy-auth-link-button" onClick={resendOtp} disabled={loading}>Resend code</button>
      </AuthModal> : null}
    </main>
  )
}

function AuthNotice({ variant, message }) {
  return <div className={`legacy-auth-notice ${variant}`}>{message}</div>
}

function AuthModal({ title, children, onClose }) {
  return <div className="legacy-auth-modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
    <section className="legacy-auth-modal">
      <header><h2>{title}</h2><button type="button" onClick={onClose} aria-label="Close">&times;</button></header>
      {children}
    </section>
  </div>
}

function focusOtpInput(refs, index) {
  refs.current[index]?.focus()
  refs.current[index]?.select?.()
}

function focusOtpGroup(refs, digits) {
  const targetIndex = Math.min(digits.findIndex((digit) => !digit), digits.length - 1)
  const safeIndex = targetIndex === -1 ? digits.length - 1 : targetIndex
  focusOtpInput(refs, safeIndex)
}

function handleOtpInput(index, value, otp, onOtpChange, refs) {
  const digits = value.replace(/\D/g, '')
  if (!digits) {
    onOtpChange(index, '')
    return
  }
  digits.slice(0, otp.length - index).split('').forEach((digit, offset) => onOtpChange(index + offset, digit))
  const nextIndex = Math.min(index + digits.length, otp.length - 1)
  focusOtpInput(refs, nextIndex)
}

function handleOtpKeyDown(index, event, otp, onOtpChange, refs) {
  if (event.key === 'Backspace') {
    if (otp[index]) {
      event.preventDefault()
      onOtpChange(index, '')
      return
    }
    if (index > 0) {
      event.preventDefault()
      focusOtpInput(refs, index - 1)
    }
  }
  if (event.key === 'ArrowLeft' && index > 0) {
    event.preventDefault()
    focusOtpInput(refs, index - 1)
  }
  if (event.key === 'ArrowRight' && index < otp.length - 1) {
    event.preventDefault()
    focusOtpInput(refs, index + 1)
  }
}

function handleOtpPaste(event, otp, onOtpChange, refs) {
  const digits = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, otp.length)
  if (!digits) return
  event.preventDefault()
  digits.split('').forEach((digit, index) => onOtpChange(index, digit))
  const focusIndex = Math.min(digits.length, otp.length) - 1
  focusOtpInput(refs, Math.max(focusIndex, 0))
}




