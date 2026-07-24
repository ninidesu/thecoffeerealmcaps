import { ArrowLeft, Eye, EyeOff, Lock, Mail, ShieldCheck, User, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

const otpDigits = 6

export default function CustomerLoginPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState('login')
  const [showLoginPassword, setShowLoginPassword] = useState(false)
  const [showRegisterPassword, setShowRegisterPassword] = useState(false)
  const [forgotOpen, setForgotOpen] = useState(false)
  const [otpOpen, setOtpOpen] = useState(false)
  const [registeredEmail, setRegisteredEmail] = useState('')
  const [pendingUsername, setPendingUsername] = useState('')
  const [pendingPassword, setPendingPassword] = useState('')
  const [otpCode, setOtpCode] = useState(Array(otpDigits).fill(''))
  const [authMessage, setAuthMessage] = useState('')
  const [authError, setAuthError] = useState('')
  const [loading, setLoading] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')

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
    navigate('/menu')
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
    const { data: otpData, error } = await supabase.functions.invoke('request-customer-otp', {
      body: { email, username },
    })
    setLoading(false)
    if (error || otpData?.success === false) return setAuthError(otpData?.error || error?.message || 'Unable to send OTP right now.')
    setRegisteredEmail(email)
    setPendingUsername(username)
    setPendingPassword(password)
    setOtpCode(Array(otpDigits).fill(''))
    setOtpOpen(true)
    setAuthMessage('We sent a 6-digit CoffeeRealm verification code to your email. Check your inbox to complete registration.')
  }

  async function verifyOtp() {
    setAuthError('')
    if (!registeredEmail) return setAuthError('Missing email address for verification.')
    const token = otpCode.join('')
    if (token.length !== otpDigits) return setAuthError('Enter the 6-digit OTP code.')
    setLoading(true)
    const { data, error } = await supabase.functions.invoke('verify-customer-otp', {
      body: { email: registeredEmail, username: pendingUsername, password: pendingPassword, otp: token },
    })
    setLoading(false)
    if (error || data?.success === false) return setAuthError(data?.error || error?.message || 'Unable to verify OTP right now.')
    const { error: loginError } = await supabase.auth.signInWithPassword({ email: registeredEmail, password: pendingPassword })
    if (loginError) return setAuthError(loginError.message)
    setOtpOpen(false)
    setPendingPassword('')
    setAuthMessage(`Account verified. Welcome, ${pendingUsername || 'customer'}!`)
    navigate('/menu')
  }

  async function resendOtp() {
    setAuthError('')
    if (!registeredEmail) return setAuthError('Missing email address for verification.')
    setLoading(true)
    const { data, error } = await supabase.functions.invoke('request-customer-otp', {
      body: { email: registeredEmail, username: pendingUsername },
    })
    setLoading(false)
    if (error || data?.success === false) return setAuthError(data?.error || error?.message || 'Unable to resend OTP right now.')
    setAuthMessage('A new 6-digit verification code was sent.')
  }

  async function submitForgotPassword(event) {
    event.preventDefault()
    setAuthError('')
    setAuthMessage('')
    if (!isSupabaseConfigured) return setAuthError('Supabase is not configured yet.')
    if (!forgotEmail.trim()) return setAuthError('Enter your email address first.')
    setLoading(true)
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail.trim(), {
      redirectTo: `${window.location.origin}/login`,
    })
    setLoading(false)
    if (error) return setAuthError(error.message)
    setForgotOpen(false)
    setAuthMessage('Password reset instructions were sent to your email.')
  }

  function changeOtpDigit(index, value) {
    const clean = value.replace(/\D/g, '').slice(-1)
    setOtpCode((current) => current.map((digit, digitIndex) => digitIndex === index ? clean : digit))
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
              <span>Password <button type="button" onClick={() => setForgotOpen(true)}>Forgot Password?</button></span>
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
            <p className="legacy-auth-hint">CoffeeRealm will send a 6-digit verification code before the customer account is created.</p>
            <button type="submit" className="legacy-auth-submit" disabled={loading}><UserPlus size={18} /> {loading ? 'SENDING...' : 'CREATE ACCOUNT'}</button>
          </form>
        </div>

        <div className="legacy-auth-toggle">
          <div className="legacy-auth-panel toggle-left">
            <img src="/images/coffeerealmlogo.png" alt="the coffee realm logo" />
            <h2>Hello, Welcome!</h2>
            <p>Don't have an account?</p>
            <button type="button" onClick={() => { setAuthError(''); setAuthMessage(''); setMode('register') }}>Register Now!</button>
          </div>
          <div className="legacy-auth-panel toggle-right">
            <img src="/images/coffeerealmlogo.png" alt="the coffee realm logo" />
            <h2>Welcome Back!</h2>
            <p>Already have an account?</p>
            <button type="button" onClick={() => { setAuthError(''); setAuthMessage(''); setMode('login') }}>Login!</button>
          </div>
        </div>
      </section>

      {forgotOpen ? <AuthModal title="Forgot Password" onClose={() => setForgotOpen(false)}>
        <form onSubmit={submitForgotPassword}>
          <p>Enter your account email and Supabase will send password reset instructions.</p>
          <label className="legacy-auth-input"><span>Email address</span><div><Mail size={19} /><input type="email" value={forgotEmail} onChange={(event) => setForgotEmail(event.target.value)} placeholder="Enter your email" /></div></label>
          <button type="submit" className="legacy-auth-submit" disabled={loading}>{loading ? 'SENDING...' : 'SEND RESET EMAIL'}</button>
        </form>
      </AuthModal> : null}

      {otpOpen ? <AuthModal title="Verify your account" onClose={() => setOtpOpen(false)}>
        <div className="legacy-otp-icon"><ShieldCheck size={30} /></div>
        <p>We sent a 6-digit verification code to <b>{registeredEmail}</b>. Enter the code here to create your account.</p>
        {authError ? <AuthNotice variant="error" message={authError} /> : null}
        {authMessage ? <AuthNotice variant="success" message={authMessage} /> : null}
        <div className="legacy-otp-inputs" aria-label="OTP code inputs">{otpCode.map((digit, index) => <input key={index} value={digit} onChange={(event) => changeOtpDigit(index, event.target.value)} inputMode="numeric" maxLength="1" aria-label={`OTP digit ${index + 1}`} />)}</div>
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




