export const DEFAULT_PRICING = Object.freeze({
  vatRate: 0.12,
  pricesIncludeVat: true,
  currency: 'PHP',
  version: 1,
})

export function roundMoney(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100
}

export function normalizePricing(value = {}) {
  const parsedRate = Number(value?.vatRate)
  const parsedVersion = Number(value?.version)

  return {
    ...DEFAULT_PRICING,
    ...value,
    vatRate: Number.isFinite(parsedRate) && parsedRate >= 0 && parsedRate <= 1
      ? parsedRate
      : DEFAULT_PRICING.vatRate,
    pricesIncludeVat: value?.pricesIncludeVat !== false,
    currency: typeof value?.currency === 'string' && value.currency.trim()
      ? value.currency.trim().toUpperCase()
      : DEFAULT_PRICING.currency,
    version: Number.isFinite(parsedVersion) ? parsedVersion : DEFAULT_PRICING.version,
  }
}

export function formatVatRate(rate) {
  return `${Math.round(Number(rate || 0) * 100)}%`
}

export function vatIncludedAmount(baseAmount, vatRate = DEFAULT_PRICING.vatRate) {
  return roundMoney(Number(baseAmount || 0) * (1 + Number(vatRate || 0)))
}

export function vatPortionOfInclusiveAmount(inclusiveAmount, vatRate = DEFAULT_PRICING.vatRate) {
  const rate = Number(vatRate || 0)
  return rate === 0 ? 0 : roundMoney(Number(inclusiveAmount || 0) * rate / (1 + rate))
}

export function vatBreakdownFromInclusiveAmount(inclusiveAmount, vatRate = DEFAULT_PRICING.vatRate, pricesIncludeVat = true) {
  const totalAmount = roundMoney(inclusiveAmount)
  if (!pricesIncludeVat) {
    return { baseAmount: totalAmount, vatAmount: 0, totalAmount }
  }

  const vatAmount = vatPortionOfInclusiveAmount(totalAmount, vatRate)
  return {
    baseAmount: roundMoney(totalAmount - vatAmount),
    vatAmount,
    totalAmount,
  }
}

export function isVatExemptDiscountType(discountType) {
  const normalized = String(discountType || '').trim().toLowerCase()
  return normalized === 'pwd' || normalized === 'senior'
}

export function vatExemptDiscountLabel() {
  return 'SC/PWD'
}

export function vatExemptDiscountBreakdown(
  inclusiveAmount,
  vatRate = DEFAULT_PRICING.vatRate,
  discountRate = 0.2,
  pricesIncludeVat = true,
) {
  const grossAmount = roundMoney(inclusiveAmount)
  const rate = Number(vatRate || 0)
  const safeDiscountRate = Number.isFinite(Number(discountRate))
    ? Math.max(0, Number(discountRate))
    : 0.2
  const standardBreakdown = vatBreakdownFromInclusiveAmount(grossAmount, rate, pricesIncludeVat)
  const vatExemptSale = standardBreakdown.baseAmount
  const vatAmount = pricesIncludeVat ? standardBreakdown.vatAmount : 0
  const discountAmount = roundMoney(vatExemptSale * safeDiscountRate)

  return {
    grossAmount,
    vatExemptSale,
    vatAmount,
    discountRate: safeDiscountRate,
    discountAmount,
    benefitAmount: roundMoney(vatAmount + discountAmount),
    totalAmount: roundMoney(vatExemptSale - discountAmount),
  }
}

/**
 * Builds the order-level breakdown used by cashier, staff, and customer
 * receipts. discountSubtotal is the gross VAT-inclusive amount of the
 * selected eligible base items; discountAmount is the stored total benefit
 * (VAT removed plus the 20% discount).
 */
export function buildVatExemptOrderBreakdown({
  subtotal = 0,
  discountSubtotal = 0,
  discountType = '',
  discountAmount = 0,
  vatExemptAmount = 0,
  vatRate = DEFAULT_PRICING.vatRate,
  pricesIncludeVat = true,
} = {}) {
  const grossSubtotal = roundMoney(subtotal)
  const eligibleGrossAmount = roundMoney(Math.min(Math.max(Number(discountSubtotal || 0), 0), grossSubtotal))
  const fullBreakdown = vatBreakdownFromInclusiveAmount(grossSubtotal, vatRate, pricesIncludeVat)
  const isEligibleDiscount = isVatExemptDiscountType(discountType) && eligibleGrossAmount > 0

  if (!isEligibleDiscount) {
    return {
      ...fullBreakdown,
      isVatExemptDiscount: false,
      regularBaseAmount: fullBreakdown.baseAmount,
      regularVatAmount: fullBreakdown.vatAmount,
      vatExemptSale: 0,
      vatExemptAmount: 0,
      discountAmount: 0,
      totalBenefitAmount: 0,
      discountSubtotal: 0,
      discountLabel: vatExemptDiscountLabel(discountType),
    }
  }

  const regularGrossAmount = roundMoney(grossSubtotal - eligibleGrossAmount)
  const regularBreakdown = vatBreakdownFromInclusiveAmount(regularGrossAmount, vatRate, pricesIncludeVat)
  const computedEligible = vatExemptDiscountBreakdown(eligibleGrossAmount, vatRate, 0.2, pricesIncludeVat)
  const storedVatExemptAmount = Number(vatExemptAmount || 0)
  const exemptVatAmount = storedVatExemptAmount > 0
    ? roundMoney(Math.min(storedVatExemptAmount, eligibleGrossAmount))
    : computedEligible.vatAmount
  const storedTotalBenefit = Number(discountAmount || 0)
  const totalBenefitAmount = storedTotalBenefit > 0
    ? roundMoney(storedTotalBenefit)
    : computedEligible.benefitAmount
  const actualDiscountAmount = roundMoney(Math.max(0, totalBenefitAmount - exemptVatAmount))
  const vatExemptSale = roundMoney(eligibleGrossAmount - exemptVatAmount)
  const totalAmount = roundMoney(regularGrossAmount + regularBreakdown.vatAmount + vatExemptSale - actualDiscountAmount)

  return {
    isVatExemptDiscount: true,
    baseAmount: roundMoney(regularBreakdown.baseAmount + vatExemptSale),
    vatAmount: regularBreakdown.vatAmount,
    totalAmount,
    regularBaseAmount: regularBreakdown.baseAmount,
    regularVatAmount: regularBreakdown.vatAmount,
    vatExemptSale,
    vatExemptAmount: exemptVatAmount,
    discountAmount: actualDiscountAmount,
    totalBenefitAmount: roundMoney(exemptVatAmount + actualDiscountAmount),
    discountSubtotal: eligibleGrossAmount,
    discountLabel: vatExemptDiscountLabel(discountType),
  }
}
