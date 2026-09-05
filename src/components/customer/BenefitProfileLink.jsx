import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { useAuth } from '../../context/AuthContext'
import { useBenefitApplication } from '../../hooks/useBenefitApplication'
import { benefitLinkLabel } from '../../services/benefitsService'

export default function BenefitProfileLink() {
  const { user } = useAuth()
  const { application, loading, error } = useBenefitApplication(user?.id)
  return <Link className="benefit-profile-link" to="/profile/benefits">
    <span>{loading ? 'Loading verification status…' : error ? 'Check Senior Citizen / PWD verification' : benefitLinkLabel(application)}</span><ArrowRight size={17} aria-hidden="true" />
  </Link>
}
