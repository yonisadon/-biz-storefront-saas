import StorefrontItemImage from '@/components/StorefrontItemImage';
import { ils } from '@/lib/format';
import type { Product } from '@/lib/types';

type BookingMode = 'none' | 'free_datetime' | 'availability';

type Props = {
  product: Product;
  quoteLabel: string;
  quantity: number;
  canOrder: boolean;
  calendarOnlyAvailable: boolean;
  bookingMode: BookingMode;
  onQuantityChange: (quantity: number) => void;
};

function QuantityStepper({ quantity, onChange, label }: { quantity: number; onChange: (quantity: number) => void; label: string }) {
  const buttonClass = 'h-9 w-9 rounded-full border-0 text-lg leading-none flex items-center justify-center text-primary transition hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" className={buttonClass} aria-label="הפחתת כמות" onClick={() => onChange(quantity - 1)}>−</button>
      <span className="w-8 text-center font-semibold" aria-live="polite">{quantity}</span>
      <button type="button" className={buttonClass} aria-label="הוספת כמות" onClick={() => onChange(quantity + 1)}>+</button>
    </div>
  );
}

/**
 * Presentation-only catalog item. Selection and order state remain owned by
 * OrderSection; this component receives the existing action as a callback.
 */
export default function StorefrontCatalogItem({
  product,
  quoteLabel,
  quantity,
  canOrder,
  calendarOnlyAvailable,
  bookingMode,
  onQuantityChange,
}: Props) {
  const canSelect = canOrder || (product.kind === 'service' && bookingMode === 'availability');
  const serviceLabel = bookingMode === 'availability'
    ? `שירות · תור ביומן ${product.appointment_duration_minutes} דק׳`
    : bookingMode === 'free_datetime'
      ? `שירות · מועד מבוקש ${product.appointment_duration_minutes} דק׳`
      : 'שירות';

  return (
    <li data-has-image={Boolean(product.image || product.additional_images?.length) ? 'true' : 'false'} className="storefront-card flex flex-col overflow-hidden rounded-2xl border bg-white">
      <StorefrontItemImage product={product} />
      <div className="flex min-w-0 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 break-words [writing-mode:horizontal-tb] font-semibold">{product.name}</h3>
          {product.kind === 'service' && (
            <span className="shrink-0 rounded-full bg-secondary/30 px-2 py-0.5 text-xs">{serviceLabel}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="storefront-card-price text-lg font-extrabold">{product.price_agorot === null ? quoteLabel : ils(product.price_agorot)}</span>
          {canSelect && (quantity > 0 ? (
            <QuantityStepper quantity={quantity} label={`כמות: ${product.name}`} onChange={onQuantityChange} />
          ) : (
            <button type="button" onClick={() => onQuantityChange(1)}
              className="storefront-card-action rounded-full border border-ink/15 bg-transparent px-4 py-2 text-sm font-semibold text-ink/85 transition hover:border-primary/35 hover:bg-primary/5">
              {calendarOnlyAvailable && product.kind === 'service' && bookingMode === 'availability' ? 'קביעת תור' : product.kind === 'service' ? 'בחר שירות' : 'בחר מוצר'}
            </button>
          ))}
        </div>
        {product.details?.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold text-primary underline underline-offset-2">פרטים נוספים ({product.details.length})</summary>
            <dl className="mt-2">
              {product.details.map((detail, index) => <div key={index} className="flex min-w-0 items-start gap-2 py-1.5">
                <dt className="w-2/5 shrink-0 break-words text-ink/60">{detail.label}</dt><dd className="min-w-0 flex-1 break-words font-medium">{detail.value}</dd>
              </div>)}
            </dl>
          </details>
        )}
        {product.description && (
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold text-primary underline underline-offset-2">{product.kind === 'service' ? 'תיאור השירות' : 'תיאור המוצר'}</summary>
            <p className="mt-2 whitespace-pre-line text-sm leading-6 text-ink/75">{product.description}</p>
          </details>
        )}
      </div>
    </li>
  );
}
