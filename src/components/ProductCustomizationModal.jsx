import { useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import Choice from './Choice'
import { money } from '../utils/money'

export default function ProductCustomizationModal({ product, onClose, onAdd }) {
  const [variationId, setVariationId] = useState('')
  const [temperature, setTemperature] = useState('')
  const [ice, setIce] = useState('Default Ice')
  const [sugar, setSugar] = useState('75%')
  const [addons, setAddons] = useState([])
  const [quantity, setQuantity] = useState(1)
  const [instructions, setInstructions] = useState('')

  const variations = product.variations || []
  const temperatures = product.temperatures || []
  const variation = variations.find((v) => v.id === (variationId || variations[0]?.id)) || null
  const selectedTemperature = temperature || temperatures[0] || ''
  const isCold = /cold|iced/i.test(selectedTemperature)
  const applicableAddons = product.allowAddons
    ? (product.addons || []).filter(
        (a) =>
          (!a.appliesTo || a.appliesTo === 'both' || a.appliesTo === product.itemType) &&
          (!a.targetTemperature || a.targetTemperature === 'both' || (isCold && /iced|cold/.test(a.targetTemperature))),
      )
    : []
  const selectedAddons = addons.filter((a) => applicableAddons.some((valid) => valid.id === a.id))
  const unitPrice = variation?.price ?? product.basePrice ?? product.price
  const total = (unitPrice + selectedAddons.reduce((sum, a) => sum + a.price, 0)) * quantity
  const toggleAddon = (addon) =>
    setAddons((current) => (current.some((x) => x.id === addon.id) ? current.filter((x) => x.id !== addon.id) : [...current, addon]))

  const confirm = () => {
    onAdd({
      productId: product.id,
      slug: product.slug || product.id,
      name: product.name,
      image: product.image,
      variation,
      temperature: selectedTemperature,
      ice: product.allowIce && isCold ? ice : '',
      sugar: product.allowSugar ? sugar : '',
      addons: selectedAddons,
      instructions,
      quantity,
      unitPrice,
    })
  }

  return (
    <div
      className="payment-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section className="payment-modal customize-modal" role="dialog" aria-modal="true" aria-labelledby="customize-modal-title">
        <button className="payment-modal-close" type="button" onClick={onClose} aria-label="Close customization">
          ×
        </button>
        <div className="customize-modal-head">
          <img src={product.image} alt={product.name} />
          <div>
            <span className="payment-modal-kicker">Customize your order</span>
            <h2 id="customize-modal-title">{product.name}</h2>
            {product.description && <p>{product.description}</p>}
          </div>
        </div>

        <div className="customize-modal-body">
          {variations.length > 0 && (
            <Choice title={product.category === 'Cakes' ? 'Portion' : 'Option'} options={variations} value={variation?.id} onChange={setVariationId} />
          )}
          {temperatures.length > 0 && (
            <Choice
              title="Temperature"
              options={temperatures.map((x) => ({ id: x, name: x }))}
              value={selectedTemperature}
              onChange={(value) => {
                setTemperature(value)
                if (!/cold|iced/i.test(value)) setAddons((current) => current.filter((a) => a.targetTemperature === 'both'))
              }}
            />
          )}
          {product.allowIce && isCold && (
            <Choice title="Ice level" options={(product.iceLevels || []).map((x) => ({ id: x, name: x }))} value={ice} onChange={setIce} />
          )}
          {product.allowSugar && (
            <Choice title="Sweetness level" options={(product.sugars || []).map((x) => ({ id: x, name: x }))} value={sugar} onChange={setSugar} />
          )}
          {applicableAddons.length > 0 && (
            <fieldset className="choice-group">
              <legend>Add-ons</legend>
              {applicableAddons.map((a) => (
                <label className="check-choice" key={a.id}>
                  <input type="checkbox" checked={selectedAddons.some((x) => x.id === a.id)} onChange={() => toggleAddon(a)} />
                  <span>{a.name}</span>
                  <b>+{money(a.price)}</b>
                </label>
              ))}
            </fieldset>
          )}
          <label className="field">
            <span>Special instructions</span>
            <textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Allergies or preparation notes" />
          </label>
        </div>

        <div className="add-bar">
          <div className="quantity">
            <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">
              <Minus />
            </button>
            <b>{quantity}</b>
            <button type="button" onClick={() => setQuantity((q) => q + 1)} aria-label="Increase quantity">
              <Plus />
            </button>
          </div>
          <button className="primary-button" type="button" onClick={confirm}>
            Add to cart · {money(total)}
          </button>
        </div>
      </section>
    </div>
  )
}
