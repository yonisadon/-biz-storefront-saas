import test from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/configValidator';

const colors = {
  primary: '#76539B',
  secondary: '#E8DDF2',
  accent: '#A78BC4',
  background: '#FCFAFE',
  text: '#30263A',
};

const baseConfig = {
  version: 1,
  order_flow: { whatsapp_enabled: true, site_inquiry_enabled: false },
};

test('legacy tenant config remains valid without storefront theme fields', () => {
  assert.equal(validateConfig(baseConfig), null);
});

test('all supported storefront themes and independent item layouts validate', () => {
  const themes = ['soft', 'flat', 'editorial', 'creative'] as const;
  const layouts = ['list', 'grid', 'carousel', 'luxury_catalog'] as const;
  for (const storefront_theme of themes) {
    for (const product_layout of layouts) {
      for (const service_layout of layouts) {
        const errors = validateConfig({
          ...baseConfig,
          branding: { colors, storefront_theme, product_layout, service_layout },
        });
        assert.equal(errors, null, errors?.join('; '));
      }
    }
  }
});

test('unsupported storefront theme and item layout values are rejected', () => {
  const invalidTheme = validateConfig({
    ...baseConfig,
    branding: { colors, storefront_theme: 'neon' },
  });
  assert.ok(invalidTheme?.some((error) => error.includes('storefront_theme')));

  const invalidLayout = validateConfig({
    ...baseConfig,
    branding: { colors, product_layout: 'masonry' },
  });
  assert.ok(invalidLayout?.some((error) => error.includes('product_layout')));
});

test('theme settings cannot bypass strict branding schema validation', () => {
  const errors = validateConfig({
    ...baseConfig,
    branding: { colors, storefront_theme: 'soft', unknown_setting: true },
  });
  assert.ok(errors && errors.length > 0);
});
