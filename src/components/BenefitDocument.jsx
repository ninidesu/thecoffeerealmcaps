import { useEffect, useState } from 'react'
import { benefitDocumentUrl } from '../services/benefitsService'

export default function BenefitDocument({ path }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setUrl(''); setError('')
    if (path) benefitDocumentUrl(path).then(value => { if (active) setUrl(value) }).catch(() => { if (active) setError('The ID image could not be loaded.') })
    return () => { active = false }
  }, [path, retry])
  if (!path) return null
  return <div className="benefit-document">
    {error ? <p role="alert">{error}</p> : url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="Submitted verification ID" onError={() => setError('The image link has expired or could not load.')} /><span>Open full-size ID</span></a> : <p role="status">Loading ID image…</p>}
    <button type="button" className="benefit-text-button" onClick={() => setRetry(value => value + 1)}>Refresh image</button>
  </div>
}
