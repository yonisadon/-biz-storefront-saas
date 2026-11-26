import StorefrontItemImage from '@/components/StorefrontItemImage';
import { useStorefrontDirection, useStorefrontLocale, useStorefrontTranslation } from '@/components/StorefrontLanguageProvider';
import type { StorefrontMessageKey } from '@/lib/storefrontI18n';
import { ils } from '@/lib/format';
import type { Product } from '@/lib/types';

type Action =
  | { type: 'catalog'; quantity: number; canOrder: boolean; canRemove: boolean; onQuantityChange: (quantity: number) => void }
  | { type: 'whatsapp'; href?: string };

type Props = {
  product: Product;
  quoteLabel: string;
  action: Action;
  itemId?: string;
  focusableTarget?: boolean;
};

function QuantityStepper({ quantity, onChange, label, canRemove, t }: { quantity: number; onChange: (quantity: number) => void; label: string; canRemove: boolean; t: (key: StorefrontMessageKey) => string }) {
  const buttonClass = 'h-9 w-9 rounded-full border-0 text-lg leading-none flex items-center justify-center text-primary transition hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-40';
  return (
    <div className="flex items-center gap-1" role="group" aria-label={label}>
      <button type="button" disabled={quantity <= 1 && !canRemove} className={buttonClass} aria-label={t('reduceQuantity')} onClick={() => onChange(quantity - 1)}>−</button>
      <span className="w-8 text-center font-semibold" aria-live="polite">{quantity}</span>
      <button type="button" className={buttonClass} aria-label={t('increaseQuantity')} onClick={() => onChange(quantity + 1)}>+</button>
    </div>
  );
}

/** Shared product/service presentation. Actions stay owned by the calling flow. */
export default function StorefrontCatalogItem({ product, quoteLabel, action, itemId, focusableTarget = false }: Props) {
  const t = useStorefrontTranslation();
  const locale = useStorefrontLocale();
  const direction = useStorefrontDirection();
  const catalogAction = action.type === 'catalog' ? action : null;
  const canSelect = catalogAction && catalogAction.canOrder;
  const serviceLabel = `${t('serviceDuration')} · ${product.appointment_duration_minutes} ${t('minutes')}`;

  const selectFromCard = () => {
    if (!catalogAction || !canSelect || catalogAction.quantity > 0) return;
    catalogAction.onQuantityChange(1);
  };

  return (
    <li
      id={itemId}
      role={canSelect ? 'group' : undefined}
      aria-label={canSelect ? `${product.name} – ${product.kind === 'service' ? t('selectService') : t('selectProduct')}` : undefined}
      tabIndex={canSelect ? 0 : focusableTarget ? -1 : undefined}
      onClick={(event) => {
        if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea, summary, details, [role="button"], [contenteditable="true"]')) return;
        selectFromCard();
      }}
      onKeyDown={(event) => {
        if (!canSelect || event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        selectFromCard();
      }}
      data-has-image={Boolean(product.image || product.additional_images?.length) ? 'true' : 'false'}
      className={`storefront-card flex flex-col overflow-hidden rounded-2xl border bg-white ${canSelect ? 'cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary' : ''} ${focusableTarget ? 'scroll-mt-24 target:ring-4 target:ring-primary/40' : ''}`}
    >
      <StorefrontItemImage product={product} />
      <div className="flex min-w-0 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 dir="auto" className="min-w-0 flex-1 break-words [writing-mode:horizontal-tb] font-semibold">{product.name}</h3>
          {product.kind === 'service' && (
            <span className="shrink-0 rounded-full bg-secondary/30 px-2 py-0.5 text-xs">{serviceLabel}</span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span dir="auto" className="storefront-card-price text-lg font-extrabold">{product.price_agorot === null ? quoteLabel : ils(product.price_agorot, locale)}</span>
          {catalogAction && canSelect && (catalogAction.quantity > 0 ? (
            <QuantityStepper quantity={catalogAction.quantity} label={`${t('itemQuantity')}: ${product.name}`} canRemove={catalogAction.canRemove} onChange={catalogAction.onQuantityChange} t={t} />
          ) : (
            <button type="button" onClick={() => catalogAction.onQuantityChange(1)}
              className="storefront-card-action inline-flex items-center gap-2 rounded-full border border-ink/15 bg-transparent px-4 py-2 text-sm font-semibold text-ink/85 transition hover:border-primary/35 hover:bg-primary/5">
              <span>{product.kind === 'service' ? t('selectService') : t('selectProduct')}</span>
              <span aria-hidden="true" className="text-base leading-none">{direction === 'rtl' ? '←' : '→'}</span>
            </button>
          ))}
          {action.type === 'whatsapp' && action.href && (
            <a href={action.href} target="_blank" rel="noopener noreferrer" className="storefront-card-action inline-flex items-center gap-2 rounded-full border border-ink/15 bg-transparent px-4 py-2 text-sm font-semibold text-ink/85 transition hover:border-primary/35 hover:bg-primary/5"><span>{t('itemWhatsAppDetails')}</span><span aria-hidden="true" className="text-base leading-none">{direction === 'rtl' ? '←' : '→'}</span></a>
          )}
        </div>
        {product.details?.length > 0 && (
          <details className="storefront-item-accordion text-sm">
            <summary className="storefront-item-accordion-summary cursor-pointer font-semibold text-primary underline underline-offset-2">{t('moreDetails')} ({product.details.length})</summary>
            <dl className="mt-2">
              {product.details.map((detail, index) => <div key={index} className="flex min-w-0 items-start gap-2 py-1.5">
                <dt dir="auto" className="w-2/5 shrink-0 break-words text-ink/60">{detail.label}</dt><dd dir="auto" className="min-w-0 flex-1 break-words font-medium">{detail.value}</dd>
              </div>)}
            </dl>
          </details>
        )}
        {product.description && (
          <details className="storefront-item-accordion text-sm">
            <summary className="storefront-item-accordion-summary cursor-pointer font-semibold text-primary underline underline-offset-2">{product.kind === 'service' ? t('serviceDescription') : t('productDescription')}</summary>
            <p dir="auto" className="mt-2 whitespace-pre-line text-sm leading-6 text-ink/75">{product.description}</p>
          </details>
        )}
      </div>
    </li>
  );
}
